-- Selling goods that are still at sea. There is no landed cost yet, so the
-- cost snapshot would be 0 and the margin a fiction. Instead take the
-- supplier's unit price from the latest shipment that carries the product and
-- mark the cost as provisional: freight and customs are not in it yet. The
-- snapshot stays frozen like every other one; the flag tells the owner which
-- margins are optimistic.

alter table public.order_line_costs add column provisional boolean not null default false;

create function private.provisional_cost() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_product uuid;
  v_qty     int;
  v_unit    bigint;
begin
  if exists (select 1 from public.product_costs pc
               join public.order_lines l on l.product_id = pc.product_id
              where l.id = new.order_line_id) then
    return new;
  end if;
  select l.product_id, l.qty into v_product, v_qty from public.order_lines l where l.id = new.order_line_id;
  select sl.unit_cost_usd_cents into v_unit
    from public.shipment_lines sl
   where sl.product_id = v_product
   order by sl.id desc
   limit 1;
  new.provisional := true;
  new.unit_cost_usd_cents := coalesce(v_unit, 0);
  new.cost_usd_cents := v_qty * coalesce(v_unit, 0);
  return new;
end $$;

create trigger order_line_costs_provisional before insert on public.order_line_costs
  for each row execute function private.provisional_cost();

-- order_profit gains the flag; everything else is unchanged
create or replace view public.order_profit with (security_invoker = true) as
  with cost as (
    select order_id, sum(cost_usd_cents)::bigint as cost_usd_cents, bool_or(provisional) as cost_provisional
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
           + coalesce(fx.fx_eur_cents, 0)                             as net_eur_cents,
         cost.cost_provisional
  from public.orders o
  join cost on cost.order_id = o.id
  join public.customers c on c.id = o.customer_id
  left join fx on fx.order_id = o.id
  where o.status = 'confirmed';
