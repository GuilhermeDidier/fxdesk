-- Orders and payments. Clients never insert into these tables directly: every
-- write goes through a SECURITY DEFINER function that re-prices from the
-- catalogue, applies the tenant's rules and snapshots the day's rate. The
-- arithmetic mirrors libs/money exactly (round half away from zero).

create type public.order_status as enum ('pending_approval', 'confirmed', 'cancelled');

create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants on delete cascade,
  number           int not null,
  customer_id      uuid not null references public.customers,
  adviser_id       uuid not null references auth.users,
  status           public.order_status not null,
  booked_on        date not null,
  -- the rate of the day, copied, so the order never depends on fx_rates again
  fx_rate_id       bigint not null references public.fx_rates,
  sdg_per_usd_e6   bigint not null,
  eur_per_usd_e6   bigint not null,
  total_usd_cents  bigint not null,
  total_sdg        bigint not null,
  total_eur_cents  bigint not null,
  paid_sdg         bigint not null default 0 check (paid_sdg >= 0),
  note             text,
  approved_by      uuid references auth.users,
  approved_at      timestamptz,
  released_by      uuid references auth.users,
  released_at      timestamptz,
  created_at       timestamptz not null default now(),
  unique (tenant_id, number),
  check (paid_sdg <= total_sdg)
);
create index on public.orders (tenant_id, booked_on);
create index on public.orders (customer_id);

create table public.order_lines (
  id                    bigint generated always as identity primary key,
  order_id              uuid not null references public.orders on delete cascade,
  tenant_id             uuid not null references public.tenants on delete cascade,
  position              int not null,
  product_id            uuid not null references public.products,
  qty                   int not null check (qty > 0),
  unit_price_usd_cents  bigint not null check (unit_price_usd_cents >= 0),
  discount_bps          int not null check (discount_bps between 0 and 10000),
  gross_usd_cents       bigint not null,
  discount_usd_cents    bigint not null,
  net_usd_cents         bigint not null,
  unique (order_id, position)
);

-- Cost snapshot taken when the order is booked. Owner-only.
create table public.order_line_costs (
  order_line_id        bigint primary key references public.order_lines on delete cascade,
  order_id             uuid not null references public.orders on delete cascade,
  tenant_id            uuid not null references public.tenants on delete cascade,
  unit_cost_usd_cents  bigint not null,
  cost_usd_cents       bigint not null
);

alter table public.stock_movements
  add constraint stock_movements_order_fk foreign key (order_id) references public.orders;

create table public.payments (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants on delete cascade,
  bank_account_id  uuid not null references public.bank_accounts,
  bank_tx_code     text not null check (length(trim(bank_tx_code)) > 0),
  customer_id      uuid not null references public.customers,
  amount_sdg       bigint not null check (amount_sdg > 0),
  received_on      date not null,
  fx_rate_id       bigint not null references public.fx_rates,
  sdg_per_usd_e6   bigint not null,
  eur_per_usd_e6   bigint not null,
  usd_value_cents  bigint not null,
  allocated_sdg    bigint not null default 0,
  proof_path       text,
  recorded_by      uuid not null references auth.users,
  created_at       timestamptz not null default now(),
  -- a transfer can only ever be recorded once
  unique (bank_account_id, bank_tx_code),
  check (allocated_sdg between 0 and amount_sdg)
);
create index on public.payments (bank_account_id, received_on);

create table public.payment_allocations (
  id                   bigint generated always as identity primary key,
  tenant_id            uuid not null references public.tenants on delete cascade,
  payment_id           uuid not null references public.payments on delete cascade,
  order_id             uuid not null references public.orders on delete cascade,
  amount_sdg           bigint not null check (amount_sdg > 0),
  -- what those pounds were worth in dollars on the order day vs the payment day
  booked_usd_cents     bigint not null,
  realized_usd_cents   bigint not null,
  fx_result_usd_cents  bigint not null,
  fx_result_eur_cents  bigint not null,
  created_at           timestamptz not null default now(),
  unique (payment_id, order_id)
);
create index on public.payment_allocations (order_id);

-- ---------------------------------------------------------------------------
-- Immutability. Booked numbers never change; the only moving parts are
-- status, approval, paid_sdg/allocated_sdg (maintained by the functions below)
-- and the warehouse release.
-- ---------------------------------------------------------------------------
create trigger fx_rates_guard before update or delete on public.fx_rates
  for each row execute function private.check_fx_rate();
create trigger fx_rates_min before insert on public.fx_rates
  for each row execute function private.check_fx_rate();

create function private.guard_order() returns trigger
language plpgsql as $$
begin
  if private.purging() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'orders are cancelled, never deleted' using errcode = 'P0001';
  end if;
  if (new.tenant_id, new.number, new.customer_id, new.adviser_id, new.booked_on, new.fx_rate_id,
      new.sdg_per_usd_e6, new.eur_per_usd_e6, new.total_usd_cents, new.total_sdg, new.total_eur_cents)
     is distinct from
     (old.tenant_id, old.number, old.customer_id, old.adviser_id, old.booked_on, old.fx_rate_id,
      old.sdg_per_usd_e6, old.eur_per_usd_e6, old.total_usd_cents, old.total_sdg, old.total_eur_cents) then
    raise exception 'booked order amounts cannot change' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger orders_guard before update or delete on public.orders
  for each row execute function private.guard_order();
create trigger order_lines_immutable before update or delete on public.order_lines
  for each row execute function private.reject_change();
create trigger order_line_costs_immutable before update or delete on public.order_line_costs
  for each row execute function private.reject_change();
create trigger payment_allocations_immutable before update or delete on public.payment_allocations
  for each row execute function private.reject_change();

create function private.guard_payment() returns trigger
language plpgsql as $$
begin
  if private.purging() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' or (to_jsonb(new) - 'allocated_sdg') is distinct from (to_jsonb(old) - 'allocated_sdg') then
    raise exception 'recorded payments cannot change' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger payments_guard before update or delete on public.payments
  for each row execute function private.guard_payment();

-- ---------------------------------------------------------------------------
-- RLS: reads only. No insert/update/delete policies means the REST API
-- cannot write these tables; the functions below are the only way in.
-- ---------------------------------------------------------------------------
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;
alter table public.order_line_costs enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;

create policy "members read orders" on public.orders for select to authenticated
  using (private.is_member(tenant_id));
create policy "members read order lines" on public.order_lines for select to authenticated
  using (private.is_member(tenant_id));
create policy "owner reads costs" on public.order_line_costs for select to authenticated
  using (private.has_role(tenant_id, '{owner}'));
create policy "cash roles read payments" on public.payments for select to authenticated
  using (private.has_role(tenant_id, '{owner,sales}'));
create policy "cash roles read allocations" on public.payment_allocations for select to authenticated
  using (private.has_role(tenant_id, '{owner,sales}'));

-- ---------------------------------------------------------------------------
-- Money helpers (same rules as libs/money).
-- ---------------------------------------------------------------------------
create function private.usd_to_sdg(usd_cents bigint, rate_e6 bigint) returns bigint
language sql immutable as $$ select round(usd_cents::numeric * rate_e6 / 100000000)::bigint $$;

create function private.usd_to_eur(usd_cents bigint, rate_e6 bigint) returns bigint
language sql immutable as $$ select round(usd_cents::numeric * rate_e6 / 1000000)::bigint $$;

create function private.sdg_to_usd(sdg bigint, rate_e6 bigint) returns bigint
language sql immutable as $$ select round(sdg::numeric * 100000000 / rate_e6)::bigint $$;

create function private.rate_on(t uuid, d date) returns public.fx_rates
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.fx_rates;
begin
  select * into r from public.fx_rates where tenant_id = t and rate_date = d;
  if not found then
    raise exception 'no exchange rate entered for %; the owner must set today''s rate first', d
      using errcode = 'P0001';
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- create_order: prices come from the catalogue, never from the client.
--   p_lines: [{"product_id": uuid, "qty": int, "discount_bps": int}, ...]
-- ---------------------------------------------------------------------------
-- private.book_order does the work for a given day and adviser; the public
-- create_order below checks the caller's role and passes today and auth.uid().
-- The demo seed books its history through the same function.
create function private.book_order(p_tenant_id uuid, p_customer_id uuid, p_adviser_id uuid, p_day date,
                                   p_lines jsonb, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  tn        public.tenants;
  today     date;
  rate      public.fx_rates;
  v_order   uuid;
  v_line    jsonb;
  v_pos     int := 0;
  v_product public.products;
  v_qty     int;
  v_bps     int;
  v_gross   bigint;
  v_disc    bigint;
  v_total   bigint := 0;
  v_blocked boolean := false;
  v_priced  jsonb := '[]';
  v_line_id bigint;
  v_cost    bigint;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'an order needs at least one line' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id and tenant_id = p_tenant_id) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;

  select * into tn from public.tenants where id = p_tenant_id;
  today := p_day;
  rate := private.rate_on(p_tenant_id, today);

  -- 1. price every line from the catalogue
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_pos := v_pos + 1;
    v_qty := (v_line ->> 'qty')::int;
    v_bps := coalesce((v_line ->> 'discount_bps')::int, 0);
    if v_qty is null or v_qty <= 0 then
      raise exception 'line %: quantity must be positive', v_pos using errcode = 'P0001';
    end if;
    if v_bps < 0 or v_bps > 10000 then
      raise exception 'line %: invalid discount', v_pos using errcode = 'P0001';
    end if;
    select * into v_product from public.products
     where id = (v_line ->> 'product_id')::uuid and tenant_id = p_tenant_id and active;
    if not found then
      raise exception 'line %: product not found', v_pos using errcode = 'P0002';
    end if;

    v_gross := v_qty::bigint * v_product.price_usd_cents;
    v_disc := round(v_gross::numeric * v_bps / 10000)::bigint;
    v_total := v_total + v_gross - v_disc;
    v_blocked := v_blocked or v_bps > tn.red_max_bps;
    v_priced := v_priced || jsonb_build_object(
      'position', v_pos, 'product_id', v_product.id, 'qty', v_qty, 'price', v_product.price_usd_cents,
      'bps', v_bps, 'gross', v_gross, 'disc', v_disc);
  end loop;

  -- 2. book the order once, with its totals and the day's rate
  update public.tenants set order_seq = order_seq + 1 where id = p_tenant_id returning * into tn;
  insert into public.orders (tenant_id, number, customer_id, adviser_id, status, booked_on, fx_rate_id,
                             sdg_per_usd_e6, eur_per_usd_e6, total_usd_cents, total_sdg, total_eur_cents,
                             note, approved_by, approved_at)
  values (p_tenant_id, tn.order_seq, p_customer_id, p_adviser_id,
          case when v_blocked then 'pending_approval' else 'confirmed' end::public.order_status,
          today, rate.id, rate.sdg_per_usd_e6, rate.eur_per_usd_e6,
          v_total, private.usd_to_sdg(v_total, rate.sdg_per_usd_e6), private.usd_to_eur(v_total, rate.eur_per_usd_e6),
          p_note,
          case when v_blocked then null else p_adviser_id end,
          case when v_blocked then null else now() end)
  returning id into v_order;

  -- 3. lines, and the cost snapshot the adviser never sees
  for v_line in select * from jsonb_array_elements(v_priced) loop
    insert into public.order_lines (order_id, tenant_id, position, product_id, qty, unit_price_usd_cents,
                                    discount_bps, gross_usd_cents, discount_usd_cents, net_usd_cents)
    values (v_order, p_tenant_id, (v_line ->> 'position')::int, (v_line ->> 'product_id')::uuid,
            (v_line ->> 'qty')::int, (v_line ->> 'price')::bigint, (v_line ->> 'bps')::int,
            (v_line ->> 'gross')::bigint, (v_line ->> 'disc')::bigint,
            (v_line ->> 'gross')::bigint - (v_line ->> 'disc')::bigint)
    returning id into v_line_id;

    select avg_landed_cost_usd_cents into v_cost from public.product_costs
     where product_id = (v_line ->> 'product_id')::uuid;
    insert into public.order_line_costs (order_line_id, order_id, tenant_id, unit_cost_usd_cents, cost_usd_cents)
    values (v_line_id, v_order, p_tenant_id, coalesce(v_cost, 0), (v_line ->> 'qty')::int * coalesce(v_cost, 0));
  end loop;

  return v_order;
end $$;

create function public.create_order(p_tenant_id uuid, p_customer_id uuid, p_lines jsonb, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_role(p_tenant_id, '{owner,sales}') then
    raise exception 'only owners and sales advisers can book orders' using errcode = '42501';
  end if;
  return private.book_order(p_tenant_id, p_customer_id, auth.uid(), private.today(p_tenant_id), p_lines, p_note);
end $$;

create function public.approve_order(p_order_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found or not private.has_role(o.tenant_id, '{owner}') then
    raise exception 'only the owner can approve a discount above the red band' using errcode = '42501';
  end if;
  if o.status <> 'pending_approval' then
    raise exception 'order is not waiting for approval' using errcode = 'P0001';
  end if;
  update public.orders set status = 'confirmed', approved_by = auth.uid(), approved_at = now()
   where id = o.id;
end $$;

create function public.cancel_order(p_order_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found or not private.has_role(o.tenant_id, '{owner}') then
    raise exception 'only the owner can cancel an order' using errcode = '42501';
  end if;
  if o.paid_sdg > 0 or o.released_at is not null then
    raise exception 'order has payments or has left the warehouse' using errcode = 'P0001';
  end if;
  update public.orders set status = 'cancelled' where id = o.id;
end $$;

-- ---------------------------------------------------------------------------
-- Payments.
-- ---------------------------------------------------------------------------
create function private.allocate(p_payment public.payments, p_order_id uuid, p_amount bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o         public.orders;
  booked    bigint;
  realized  bigint;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'allocation must be positive' using errcode = 'P0001';
  end if;
  select * into o from public.orders where id = p_order_id and tenant_id = p_payment.tenant_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if o.status <> 'confirmed' then
    raise exception 'order #% is not confirmed', o.number using errcode = 'P0001';
  end if;
  if o.customer_id <> p_payment.customer_id then
    raise exception 'order #% belongs to another customer', o.number using errcode = 'P0001';
  end if;
  if o.paid_sdg + p_amount > o.total_sdg then
    raise exception 'order #% only has % SDG left to pay', o.number, o.total_sdg - o.paid_sdg
      using errcode = 'P0001';
  end if;
  if p_payment.allocated_sdg + p_amount > p_payment.amount_sdg then
    raise exception 'allocations exceed the transfer amount' using errcode = 'P0001';
  end if;

  booked := private.sdg_to_usd(p_amount, o.sdg_per_usd_e6);
  realized := private.sdg_to_usd(p_amount, p_payment.sdg_per_usd_e6);

  insert into public.payment_allocations (tenant_id, payment_id, order_id, amount_sdg, booked_usd_cents,
                                          realized_usd_cents, fx_result_usd_cents, fx_result_eur_cents)
  values (p_payment.tenant_id, p_payment.id, o.id, p_amount, booked, realized, realized - booked,
          private.usd_to_eur(realized - booked, p_payment.eur_per_usd_e6));

  update public.orders set paid_sdg = paid_sdg + p_amount where id = o.id;
  update public.payments set allocated_sdg = allocated_sdg + p_amount where id = p_payment.id;
end $$;
revoke execute on function private.allocate(public.payments, uuid, bigint) from public, authenticated;

--   p_allocations: [{"order_id": uuid, "amount_sdg": int}, ...]
create function private.book_payment(
  p_bank_account_id uuid, p_bank_tx_code text, p_amount_sdg bigint, p_customer_id uuid,
  p_allocations jsonb, p_received_on date, p_proof_path text, p_recorded_by uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  acct     public.bank_accounts;
  tn       public.tenants;
  day      date;
  rate     public.fx_rates;
  used     bigint;
  p        public.payments;
  a        jsonb;
begin
  -- lock the account so two advisers cannot both use the last of today's limit
  select * into acct from public.bank_accounts where id = p_bank_account_id and active for update;
  if not found then
    raise exception 'bank account not found' using errcode = 'P0002';
  end if;
  select * into tn from public.tenants where id = acct.tenant_id;

  if p_amount_sdg is null or p_amount_sdg <= 0 then
    raise exception 'amount must be positive' using errcode = 'P0001';
  end if;
  if p_amount_sdg > tn.max_transfer_sdg then
    raise exception 'a single transfer cannot exceed % SDG', tn.max_transfer_sdg using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id and tenant_id = acct.tenant_id) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;

  day := coalesce(p_received_on, private.today(acct.tenant_id));
  if day > private.today(acct.tenant_id) then
    raise exception 'payment date is in the future' using errcode = 'P0001';
  end if;
  rate := private.rate_on(acct.tenant_id, day);

  if exists (select 1 from public.payments where bank_account_id = acct.id and bank_tx_code = trim(p_bank_tx_code)) then
    raise exception 'transaction % is already recorded on this account', trim(p_bank_tx_code)
      using errcode = '23505';
  end if;

  select coalesce(sum(amount_sdg), 0) into used
    from public.payments where bank_account_id = acct.id and received_on = day;
  if used + p_amount_sdg > acct.daily_limit_sdg then
    raise exception '% can only receive % SDG more on %', acct.name, acct.daily_limit_sdg - used, day
      using errcode = 'P0001';
  end if;

  insert into public.payments (tenant_id, bank_account_id, bank_tx_code, customer_id, amount_sdg, received_on,
                               fx_rate_id, sdg_per_usd_e6, eur_per_usd_e6, usd_value_cents, proof_path, recorded_by)
  values (acct.tenant_id, acct.id, trim(p_bank_tx_code), p_customer_id, p_amount_sdg, day,
          rate.id, rate.sdg_per_usd_e6, rate.eur_per_usd_e6, private.sdg_to_usd(p_amount_sdg, rate.sdg_per_usd_e6),
          p_proof_path, p_recorded_by)
  returning * into p;

  for a in select * from jsonb_array_elements(coalesce(p_allocations, '[]')) loop
    perform private.allocate(p, (a ->> 'order_id')::uuid, (a ->> 'amount_sdg')::bigint);
    select * into p from public.payments where id = p.id;
  end loop;

  return p.id;
end $$;

create function public.record_payment(
  p_bank_account_id uuid, p_bank_tx_code text, p_amount_sdg bigint, p_customer_id uuid,
  p_allocations jsonb default '[]', p_received_on date default null, p_proof_path text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  t uuid;
begin
  select tenant_id into t from public.bank_accounts where id = p_bank_account_id;
  if t is null or not private.has_role(t, '{owner,sales}') then
    raise exception 'bank account not found' using errcode = 'P0002';
  end if;
  if p_proof_path is not null and split_part(p_proof_path, '/', 1) <> t::text then
    raise exception 'proof must be stored in the tenant folder' using errcode = 'P0001';
  end if;
  return private.book_payment(p_bank_account_id, p_bank_tx_code, p_amount_sdg, p_customer_id,
                              p_allocations, p_received_on, p_proof_path, auth.uid());
end $$;

create function public.allocate_payment(p_payment_id uuid, p_order_id uuid, p_amount_sdg bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.payments;
begin
  select * into p from public.payments where id = p_payment_id for update;
  if not found or not private.has_role(p.tenant_id, '{owner,sales}') then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  perform private.allocate(p, p_order_id, p_amount_sdg);
end $$;

-- ---------------------------------------------------------------------------
-- The warehouse releases goods only for a fully paid order.
-- ---------------------------------------------------------------------------
create function public.release_order(p_order_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o         public.orders;
  l         record;
  on_hand   int;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found or not private.has_role(o.tenant_id, '{owner,warehouse}') then
    raise exception 'only the warehouse can release goods' using errcode = '42501';
  end if;
  if o.status <> 'confirmed' then
    raise exception 'order #% is not confirmed', o.number using errcode = 'P0001';
  end if;
  if o.released_at is not null then
    raise exception 'order #% has already been released', o.number using errcode = 'P0001';
  end if;
  if o.paid_sdg < o.total_sdg then
    raise exception 'order #% is not fully paid: % SDG outstanding', o.number, o.total_sdg - o.paid_sdg
      using errcode = 'P0001';
  end if;

  for l in select product_id, sum(qty)::int as qty from public.order_lines where order_id = o.id group by product_id loop
    perform pg_advisory_xact_lock(hashtext(l.product_id::text));
    select coalesce(sum(qty), 0) into on_hand from public.stock_movements where product_id = l.product_id;
    if on_hand < l.qty then
      raise exception 'not enough stock to release order #%', o.number using errcode = 'P0001';
    end if;
    insert into public.stock_movements (tenant_id, product_id, qty, kind, order_id)
    values (o.tenant_id, l.product_id, -l.qty, 'release', o.id);
  end loop;

  update public.orders set released_at = now(), released_by = auth.uid() where id = o.id;
end $$;

-- ---------------------------------------------------------------------------
-- Function privileges: only signed-in users, never anon.
-- ---------------------------------------------------------------------------
revoke execute on function public.create_order(uuid, uuid, jsonb, text) from public, anon;
revoke execute on function public.approve_order(uuid) from public, anon;
revoke execute on function public.cancel_order(uuid) from public, anon;
revoke execute on function public.record_payment(uuid, text, bigint, uuid, jsonb, date, text) from public, anon;
revoke execute on function public.allocate_payment(uuid, uuid, bigint) from public, anon;
revoke execute on function public.release_order(uuid) from public, anon;
revoke execute on function public.close_shipment(uuid) from public, anon;
grant execute on function public.create_order(uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.approve_order(uuid) to authenticated;
grant execute on function public.cancel_order(uuid) to authenticated;
grant execute on function public.record_payment(uuid, text, bigint, uuid, jsonb, date, text) to authenticated;
grant execute on function public.allocate_payment(uuid, uuid, bigint) to authenticated;
grant execute on function public.release_order(uuid) to authenticated;
grant execute on function public.close_shipment(uuid) to authenticated;

revoke execute on function private.book_order(uuid, uuid, uuid, date, jsonb, text) from public, authenticated;
revoke execute on function private.book_payment(uuid, text, bigint, uuid, jsonb, date, text, uuid) from public, authenticated;
