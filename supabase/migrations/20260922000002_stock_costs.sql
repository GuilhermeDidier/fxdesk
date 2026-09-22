-- Stock and landed cost. Everything that reveals what the goods cost is
-- readable by the owner only; the sales adviser gets zero rows back even when
-- querying the REST API directly with their own token.

create table public.shipments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants on delete cascade,
  reference   text not null,
  supplier    text not null,
  arrived_on  date,
  status      text not null default 'open' check (status in ('open', 'closed')),
  closed_at   timestamptz,
  unique (tenant_id, reference)
);

create table public.shipment_lines (
  id                           bigint generated always as identity primary key,
  shipment_id                  uuid not null references public.shipments on delete cascade,
  tenant_id                    uuid not null references public.tenants on delete cascade,
  product_id                   uuid not null references public.products,
  qty                          int not null check (qty > 0),
  unit_cost_usd_cents          bigint not null check (unit_cost_usd_cents >= 0),
  -- filled when the shipment is closed
  allocated_charges_usd_cents  bigint,
  landed_unit_cost_usd_cents   bigint
);

create table public.shipment_charges (
  id               bigint generated always as identity primary key,
  shipment_id      uuid not null references public.shipments on delete cascade,
  tenant_id        uuid not null references public.tenants on delete cascade,
  kind             text not null check (kind in ('freight', 'customs', 'transport', 'other')),
  amount_usd_cents bigint not null check (amount_usd_cents >= 0),
  note             text
);

-- Current moving-average landed cost per product.
create table public.product_costs (
  product_id                uuid primary key references public.products on delete cascade,
  tenant_id                 uuid not null references public.tenants on delete cascade,
  avg_landed_cost_usd_cents bigint not null check (avg_landed_cost_usd_cents >= 0),
  updated_at                timestamptz not null default now()
);

create table public.stock_movements (
  id           bigint generated always as identity primary key,
  tenant_id    uuid not null references public.tenants on delete cascade,
  product_id   uuid not null references public.products,
  qty          int not null check (qty <> 0),
  kind         text not null check (kind in ('receipt', 'release', 'adjustment')),
  shipment_id  uuid references public.shipments,
  order_id     uuid, -- fk added with orders
  created_by   uuid default auth.uid() references auth.users on delete set null,
  created_at   timestamptz not null default now()
);
create index on public.stock_movements (tenant_id, product_id);

create trigger stock_movements_append_only before update or delete on public.stock_movements
  for each row execute function private.reject_change();

alter table public.shipments enable row level security;
alter table public.shipment_lines enable row level security;
alter table public.shipment_charges enable row level security;
alter table public.product_costs enable row level security;
alter table public.stock_movements enable row level security;

create policy "owner only" on public.shipments for all to authenticated
  using (private.has_role(tenant_id, '{owner}')) with check (private.has_role(tenant_id, '{owner}'));
create policy "owner only" on public.shipment_lines for all to authenticated
  using (private.has_role(tenant_id, '{owner}')) with check (private.has_role(tenant_id, '{owner}'));
create policy "owner only" on public.shipment_charges for all to authenticated
  using (private.has_role(tenant_id, '{owner}')) with check (private.has_role(tenant_id, '{owner}'));
create policy "owner only" on public.product_costs for select to authenticated
  using (private.has_role(tenant_id, '{owner}'));
-- Quantities are not sensitive: everyone can see stock, only RPCs move it.
create policy "members read movements" on public.stock_movements for select to authenticated
  using (private.is_member(tenant_id));

create view public.stock_levels with (security_invoker = true) as
  select p.tenant_id, p.id as product_id, p.sku, p.name, p.category, p.min_stock,
         coalesce(sum(m.qty), 0)::int as on_hand,
         coalesce(sum(m.qty), 0) < p.min_stock as below_min
  from public.products p
  left join public.stock_movements m on m.product_id = p.id
  group by p.id;

-- ---------------------------------------------------------------------------
-- Closing a shipment spreads freight, customs and transport over every unit in
-- proportion to its purchase value, receives the goods into stock and updates
-- the moving-average cost. Rounding remainders go to the largest line so the
-- allocated charges always add up to the charges paid, to the cent.
-- ---------------------------------------------------------------------------
create function public.close_shipment(p_shipment_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s             public.shipments;
  total_value   bigint;
  total_charges bigint;
  remainder     bigint;
  l             record;
  on_hand       bigint;
  old_avg       bigint;
begin
  select * into s from public.shipments where id = p_shipment_id for update;
  if not found or not private.has_role(s.tenant_id, '{owner}') then
    raise exception 'shipment not found' using errcode = 'P0002';
  end if;
  if s.status = 'closed' then
    raise exception 'shipment % is already closed', s.reference using errcode = 'P0001';
  end if;

  select coalesce(sum(qty::bigint * unit_cost_usd_cents), 0) into total_value
    from public.shipment_lines where shipment_id = s.id;
  select coalesce(sum(amount_usd_cents), 0) into total_charges
    from public.shipment_charges where shipment_id = s.id;
  if total_value = 0 then
    raise exception 'shipment has no goods' using errcode = 'P0001';
  end if;

  update public.shipment_lines sl
     set allocated_charges_usd_cents =
           round(total_charges::numeric * sl.qty * sl.unit_cost_usd_cents / total_value)::bigint
   where sl.shipment_id = s.id;

  select total_charges - sum(allocated_charges_usd_cents) into remainder
    from public.shipment_lines where shipment_id = s.id;
  update public.shipment_lines
     set allocated_charges_usd_cents = allocated_charges_usd_cents + remainder
   where id = (select id from public.shipment_lines where shipment_id = s.id
               order by qty::bigint * unit_cost_usd_cents desc, id limit 1);

  update public.shipment_lines
     set landed_unit_cost_usd_cents =
           round((qty::numeric * unit_cost_usd_cents + allocated_charges_usd_cents) / qty)::bigint
   where shipment_id = s.id;

  for l in select * from public.shipment_lines where shipment_id = s.id order by id loop
    select coalesce(sum(qty), 0) into on_hand from public.stock_movements where product_id = l.product_id;
    select avg_landed_cost_usd_cents into old_avg from public.product_costs where product_id = l.product_id;
    on_hand := greatest(on_hand, 0);

    insert into public.product_costs (product_id, tenant_id, avg_landed_cost_usd_cents, updated_at)
    values (l.product_id, s.tenant_id,
            case when old_avg is null or on_hand = 0 then l.landed_unit_cost_usd_cents
                 else round((on_hand::numeric * old_avg + l.qty::numeric * l.landed_unit_cost_usd_cents)
                            / (on_hand + l.qty))::bigint end,
            now())
    on conflict (product_id) do update
      set avg_landed_cost_usd_cents = excluded.avg_landed_cost_usd_cents, updated_at = now();

    insert into public.stock_movements (tenant_id, product_id, qty, kind, shipment_id)
    values (s.tenant_id, l.product_id, l.qty, 'receipt', s.id);
  end loop;

  update public.shipments set status = 'closed', closed_at = now(),
         arrived_on = coalesce(arrived_on, private.today(s.tenant_id))
   where id = s.id;
end $$;

-- Closed shipments are part of the books.
create function private.guard_closed_shipment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  sid uuid := coalesce(new.shipment_id, old.shipment_id);
begin
  if not private.purging()
     and exists (select 1 from public.shipments where id = sid and status = 'closed') then
    raise exception 'shipment is closed; post a new adjustment instead' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

create trigger shipment_lines_closed before insert or update or delete on public.shipment_lines
  for each row execute function private.guard_closed_shipment();
create trigger shipment_charges_closed before insert or update or delete on public.shipment_charges
  for each row execute function private.guard_closed_shipment();

create function private.guard_shipment_reopen() returns trigger
language plpgsql as $$
begin
  if old.status = 'closed' and not private.purging() then
    raise exception 'shipment % is closed and cannot change', old.reference using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

create trigger shipments_closed before update or delete on public.shipments
  for each row execute function private.guard_shipment_reopen();
