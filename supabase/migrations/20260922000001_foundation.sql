-- Foundation: tenants, roles, settings, exchange rates, catalogue.
--
-- Conventions (docs/money.md):
--   *_usd_cents / *_eur_cents  bigint, cents
--   *_sdg                      bigint, whole pounds
--   *_e6                       bigint, rate x 10^6 (units per 1 USD)
--   *_bps                      int, basis points (1% = 100)
-- Every business table carries tenant_id and is protected by RLS.

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

create type public.app_role as enum ('owner', 'marketing', 'sales', 'warehouse');

create table public.tenants (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  -- white-label
  brand_name          text not null,
  brand_color         text not null default '#1d4a3a' check (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  -- configurable business rules
  timezone            text not null default 'Africa/Khartoum',
  sand_max_bps        int not null default 300 check (sand_max_bps between 0 and 10000),
  red_max_bps         int not null default 500 check (red_max_bps between 0 and 10000),
  min_sdg_per_usd_e6  bigint not null default 1 check (min_sdg_per_usd_e6 > 0),
  max_transfer_sdg    bigint not null default 3000000 check (max_transfer_sdg > 0),
  order_seq           int not null default 0,
  created_at          timestamptz not null default now(),
  check (red_max_bps >= sand_max_bps)
);

create table public.memberships (
  tenant_id     uuid not null references public.tenants on delete cascade,
  user_id       uuid not null references auth.users on delete cascade,
  role          public.app_role not null,
  display_name  text not null,
  primary key (tenant_id, user_id)
);
create index on public.memberships (user_id);

-- ---------------------------------------------------------------------------
-- Role helpers. SECURITY DEFINER so policies can read memberships without
-- recursing into memberships' own RLS. Kept in the unexposed private schema.
-- ---------------------------------------------------------------------------
create function private.role_in(t uuid) returns public.app_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.memberships m
  where m.tenant_id = t and m.user_id = (select auth.uid())
$$;

create function private.is_member(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.role_in(t) is not null
$$;

create function private.has_role(t uuid, roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.role_in(t) = any (roles), false)
$$;

-- "Today" is the tenant's business day, not the server's UTC day.
create function private.today(t uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone tn.timezone)::date from public.tenants tn where tn.id = t
$$;

-- Escape hatch used only by the service role to delete test tenants: the
-- immutability triggers below otherwise refuse every delete.
create function private.purging() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.purge', true), '') = 'on'
$$;

grant execute on all functions in schema private to authenticated, service_role;

create function private.purge_tenant(t uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('app.purge', 'on', true);
  delete from public.tenants where id = t;
end $$;
revoke execute on function private.purge_tenant(uuid) from public, authenticated;
grant execute on function private.purge_tenant(uuid) to service_role;

create function private.reject_change() returns trigger
language plpgsql as $$
begin
  if private.purging() then
    return coalesce(new, old);
  end if;
  raise exception '% on % is not allowed: this record is part of the books', tg_op, tg_table_name
    using errcode = 'P0001';
end $$;

alter table public.tenants enable row level security;
alter table public.memberships enable row level security;

create policy "members read their tenant" on public.tenants
  for select to authenticated using (private.is_member(id));
create policy "owner edits settings" on public.tenants
  for update to authenticated
  using (private.has_role(id, '{owner}')) with check (private.has_role(id, '{owner}'));

create policy "members see the team" on public.memberships
  for select to authenticated using (private.is_member(tenant_id));
create policy "owner manages the team" on public.memberships
  for all to authenticated
  using (private.has_role(tenant_id, '{owner}')) with check (private.has_role(tenant_id, '{owner}'));

-- ---------------------------------------------------------------------------
-- Exchange rates: one row per tenant per day, never edited once used.
-- ---------------------------------------------------------------------------
create table public.fx_rates (
  id              bigint generated always as identity primary key,
  tenant_id       uuid not null references public.tenants on delete cascade,
  rate_date       date not null,
  sdg_per_usd_e6  bigint not null check (sdg_per_usd_e6 > 0),
  eur_per_usd_e6  bigint not null check (eur_per_usd_e6 > 0),
  source          text not null default 'manual',
  created_by      uuid default auth.uid() references auth.users on delete set null,
  created_at      timestamptz not null default now(),
  unique (tenant_id, rate_date)
);

create function private.check_fx_rate() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  min_rate bigint;
begin
  if tg_op in ('UPDATE', 'DELETE') and not private.purging() then
    if exists (select 1 from public.orders where fx_rate_id = old.id)
       or exists (select 1 from public.payments where fx_rate_id = old.id) then
      raise exception 'rate of % is already used by orders or payments and cannot change', old.rate_date
        using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  select min_sdg_per_usd_e6 into min_rate from public.tenants where id = new.tenant_id;
  if new.sdg_per_usd_e6 < min_rate then
    raise exception 'rate is below the configured minimum exchange rate' using errcode = 'P0001';
  end if;
  return new;
end $$;

alter table public.fx_rates enable row level security;
create policy "members read rates" on public.fx_rates
  for select to authenticated using (private.is_member(tenant_id));
create policy "owner sets rates" on public.fx_rates
  for insert to authenticated with check (private.has_role(tenant_id, '{owner}'));
create policy "owner corrects unused rates" on public.fx_rates
  for update to authenticated using (private.has_role(tenant_id, '{owner}'));

-- ---------------------------------------------------------------------------
-- Catalogue and customers. Note: products has no cost column on purpose.
-- Costs live in tables only the owner can read (see stock migration).
-- ---------------------------------------------------------------------------
create table public.products (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants on delete cascade,
  sku              text not null,
  name             text not null,
  category         text not null check (category in ('inverter', 'battery', 'panel', 'pump', 'other')),
  price_usd_cents  bigint not null check (price_usd_cents >= 0),
  min_stock        int not null default 0 check (min_stock >= 0),
  active           boolean not null default true,
  unique (tenant_id, sku)
);

create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants on delete cascade,
  name        text not null,
  phone       text,
  city        text,
  labels      text[] not null default '{}',
  created_at  timestamptz not null default now()
);
create index on public.customers (tenant_id);

alter table public.products enable row level security;
alter table public.customers enable row level security;

create policy "members read products" on public.products
  for select to authenticated using (private.is_member(tenant_id));
create policy "owner manages products" on public.products
  for all to authenticated
  using (private.has_role(tenant_id, '{owner}')) with check (private.has_role(tenant_id, '{owner}'));

create policy "members read customers" on public.customers
  for select to authenticated using (private.is_member(tenant_id));
create policy "front office adds customers" on public.customers
  for insert to authenticated with check (private.has_role(tenant_id, '{owner,sales,marketing}'));
create policy "front office edits customers" on public.customers
  for update to authenticated using (private.has_role(tenant_id, '{owner,sales,marketing}'));

create table public.bank_accounts (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants on delete cascade,
  name             text not null,
  bank             text not null,
  daily_limit_sdg  bigint not null default 15000000 check (daily_limit_sdg > 0),
  active           boolean not null default true
);

alter table public.bank_accounts enable row level security;
create policy "cash roles read accounts" on public.bank_accounts
  for select to authenticated using (private.has_role(tenant_id, '{owner,sales}'));
create policy "owner manages accounts" on public.bank_accounts
  for all to authenticated
  using (private.has_role(tenant_id, '{owner}')) with check (private.has_role(tenant_id, '{owner}'));
