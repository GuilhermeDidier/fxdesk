-- Quotes. A quote is an order that has not been booked: same lines, same
-- pricing, priced at the rate of the day it was written, but it takes no
-- payments, reserves no stock and never reaches a report. Turning it into an
-- order books a new order at the rate of the day it is accepted, because
-- the pound may have moved since the quote went out.

alter type public.order_status add value if not exists 'quote' before 'pending_approval';

alter table public.orders
  add column converted_to uuid references public.orders,
  add column quoted_from  uuid references public.orders;

create function public.create_quote(p_tenant_id uuid, p_customer_id uuid, p_lines jsonb, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not private.has_role(p_tenant_id, '{owner,sales}') then
    raise exception 'only owners and sales advisers can write quotes' using errcode = '42501';
  end if;
  v_id := private.book_order(p_tenant_id, p_customer_id, auth.uid(), private.today(p_tenant_id), p_lines, p_note);
  update public.orders set status = 'quote', approved_by = null, approved_at = null where id = v_id;
  return v_id;
end $$;

create function public.convert_quote(p_quote_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  q     public.orders;
  lines jsonb;
  v_new uuid;
begin
  select * into q from public.orders where id = p_quote_id for update;
  if not found or not private.has_role(q.tenant_id, '{owner,sales}') then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;
  if q.status <> 'quote' then
    raise exception 'order #% is not a quote', q.number using errcode = 'P0001';
  end if;
  if q.converted_to is not null then
    raise exception 'quote #% has already been turned into an order', q.number using errcode = 'P0001';
  end if;

  select jsonb_agg(jsonb_build_object('product_id', product_id, 'qty', qty, 'discount_bps', discount_bps) order by position)
    into lines from public.order_lines where order_id = q.id;

  v_new := private.book_order(q.tenant_id, q.customer_id, auth.uid(), private.today(q.tenant_id), lines, q.note);
  update public.orders set quoted_from = q.id where id = v_new;
  update public.orders set converted_to = v_new where id = q.id;
  return v_new;
end $$;

revoke execute on function public.create_quote(uuid, uuid, jsonb, text) from public, anon;
revoke execute on function public.convert_quote(uuid) from public, anon;
grant execute on function public.create_quote(uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.convert_quote(uuid) to authenticated;

-- A quote that already became an order stays as the record of what was offered.
create or replace function public.cancel_order(p_order_id uuid) returns void
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
  if o.converted_to is not null then
    raise exception 'quote #% is already an order; cancel the order instead', o.number using errcode = 'P0001';
  end if;
  update public.orders set status = 'cancelled' where id = o.id;
end $$;
