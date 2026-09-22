-- Reports. Every view is security_invoker, so the RLS of the tables underneath
-- still applies: a sales adviser selecting from order_profit gets zero rows,
-- because the inner join to order_line_costs returns nothing for them.
--
-- Views only add up integers that were stored when things happened. Nothing
-- here joins the "current" rate, price or cost, which is why a report on a
-- closed period returns the same numbers forever.

create view public.order_profit with (security_invoker = true) as
  with cost as (
    select order_id, sum(cost_usd_cents)::bigint as cost_usd_cents
    from public.order_line_costs group by order_id
  ), fx as (
    select order_id, sum(fx_result_usd_cents)::bigint as fx_usd_cents, sum(fx_result_eur_cents)::bigint as fx_eur_cents
    from public.payment_allocations group by order_id
  )
  select o.tenant_id, o.id as order_id, o.number, o.booked_on, o.customer_id, c.name as customer_name,
         o.total_usd_cents                                            as revenue_usd_cents,
         cost.cost_usd_cents,
         o.total_usd_cents - cost.cost_usd_cents                      as margin_usd_cents,
         coalesce(fx.fx_usd_cents, 0)                                 as fx_usd_cents,
         o.total_usd_cents - cost.cost_usd_cents + coalesce(fx.fx_usd_cents, 0) as net_usd_cents,
         o.total_eur_cents                                            as revenue_eur_cents,
         private.usd_to_eur(cost.cost_usd_cents, o.eur_per_usd_e6)    as cost_eur_cents,
         o.total_eur_cents - private.usd_to_eur(cost.cost_usd_cents, o.eur_per_usd_e6) as margin_eur_cents,
         coalesce(fx.fx_eur_cents, 0)                                 as fx_eur_cents,
         o.total_eur_cents - private.usd_to_eur(cost.cost_usd_cents, o.eur_per_usd_e6)
           + coalesce(fx.fx_eur_cents, 0)                             as net_eur_cents
  from public.orders o
  join cost on cost.order_id = o.id
  join public.customers c on c.id = o.customer_id
  left join fx on fx.order_id = o.id
  where o.status = 'confirmed';

-- Line level: for product and customer reports. Currency result is realised on
-- the order as a whole, so these are margins before the currency result.
create view public.line_profit with (security_invoker = true) as
  select o.tenant_id, o.id as order_id, o.number, o.booked_on, o.customer_id, c.name as customer_name,
         p.id as product_id, p.sku, p.name as product_name, p.category,
         l.qty,
         l.net_usd_cents                                               as revenue_usd_cents,
         k.cost_usd_cents,
         l.net_usd_cents - k.cost_usd_cents                            as margin_usd_cents,
         private.usd_to_eur(l.net_usd_cents, o.eur_per_usd_e6)         as revenue_eur_cents,
         private.usd_to_eur(k.cost_usd_cents, o.eur_per_usd_e6)        as cost_eur_cents,
         private.usd_to_eur(l.net_usd_cents - k.cost_usd_cents, o.eur_per_usd_e6) as margin_eur_cents
  from public.order_lines l
  join public.order_line_costs k on k.order_line_id = l.id
  join public.orders o on o.id = l.order_id
  join public.customers c on c.id = o.customer_id
  join public.products p on p.id = l.product_id
  where o.status = 'confirmed';

-- Period report. Sales and cost belong to the day the order was booked; the
-- currency result belongs to the day the money arrived. A late payment on an
-- old order therefore lands in the month it was received and never rewrites
-- a month that is already closed.
create view public.profit_by_period with (security_invoker = true) as
  with sales as (
    select tenant_id, booked_on as day, revenue_usd_cents, cost_usd_cents, revenue_eur_cents, cost_eur_cents,
           0::bigint as fx_usd_cents, 0::bigint as fx_eur_cents, 1 as orders
    from public.order_profit
  ), fx as (
    select a.tenant_id, p.received_on as day, 0::bigint, 0::bigint, 0::bigint, 0::bigint,
           a.fx_result_usd_cents, a.fx_result_eur_cents, 0
    from public.payment_allocations a
    join public.payments p on p.id = a.payment_id
    join public.orders o on o.id = a.order_id and o.status = 'confirmed'
    where exists (select 1 from public.order_line_costs k where k.order_id = a.order_id)
  ), all_rows as (
    select * from sales union all select * from fx
  ), grains as (
    select 'month' as grain, date_trunc('month', day)::date as period_start, r.* from all_rows r
    union all
    select 'week', date_trunc('week', day)::date, r.* from all_rows r
  )
  select tenant_id, grain, period_start,
         sum(orders)::int                                           as orders,
         sum(revenue_usd_cents)::bigint                             as revenue_usd_cents,
         sum(cost_usd_cents)::bigint                                as cost_usd_cents,
         sum(revenue_usd_cents - cost_usd_cents)::bigint            as margin_usd_cents,
         sum(fx_usd_cents)::bigint                                  as fx_usd_cents,
         sum(revenue_usd_cents - cost_usd_cents + fx_usd_cents)::bigint as net_usd_cents,
         sum(revenue_eur_cents)::bigint                             as revenue_eur_cents,
         sum(cost_eur_cents)::bigint                                as cost_eur_cents,
         sum(revenue_eur_cents - cost_eur_cents)::bigint            as margin_eur_cents,
         sum(fx_eur_cents)::bigint                                  as fx_eur_cents,
         sum(revenue_eur_cents - cost_eur_cents + fx_eur_cents)::bigint as net_eur_cents
  from grains
  group by tenant_id, grain, period_start;

-- Bank accounts: balance received and how much of today's limit is left.
create view public.bank_account_status with (security_invoker = true) as
  select a.tenant_id, a.id as bank_account_id, a.name, a.bank, a.daily_limit_sdg,
         coalesce(sum(p.amount_sdg) filter (where p.received_on = private.today(a.tenant_id)), 0)::bigint as received_today_sdg,
         a.daily_limit_sdg
           - coalesce(sum(p.amount_sdg) filter (where p.received_on = private.today(a.tenant_id)), 0)::bigint as remaining_today_sdg,
         coalesce(sum(p.amount_sdg), 0)::bigint as received_total_sdg,
         coalesce(sum(p.amount_sdg - p.allocated_sdg), 0)::bigint as unallocated_sdg
  from public.bank_accounts a
  left join public.payments p on p.bank_account_id = a.id
  where a.active
  group by a.id;

revoke all on public.order_profit, public.line_profit, public.profit_by_period, public.bank_account_status,
              public.stock_levels from anon;

-- ---------------------------------------------------------------------------
-- Proof-of-transfer photos: private bucket, one folder per tenant.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy "cash roles upload proofs" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] in (
      select tenant_id::text from public.memberships
      where user_id = (select auth.uid()) and role in ('owner', 'sales'))
  );

create policy "cash roles read proofs" on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] in (
      select tenant_id::text from public.memberships
      where user_id = (select auth.uid()) and role in ('owner', 'sales'))
  );
