-- Guard against a mistyped rate. Every order and payment of the day copies it
-- and it freezes on first use, so "80125" instead of "8012.5" would be booked
-- into the books for good. A new rate may move at most max_rate_move_bps
-- against the latest earlier rate (15% by default; a real devaluation day can
-- be larger, so it is a per-company setting the owner can raise).

alter table public.tenants
  add column max_rate_move_bps int not null default 1500 check (max_rate_move_bps between 1 and 100000);

create or replace function private.check_fx_rate() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  tn   public.tenants;
  prev public.fx_rates;
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

  select * into tn from public.tenants where id = new.tenant_id;
  if new.sdg_per_usd_e6 < tn.min_sdg_per_usd_e6 then
    raise exception 'rate is below the configured minimum exchange rate' using errcode = 'P0001';
  end if;

  select * into prev from public.fx_rates
   where tenant_id = new.tenant_id and rate_date < new.rate_date
   order by rate_date desc limit 1;
  if found and abs(new.sdg_per_usd_e6 - prev.sdg_per_usd_e6)::numeric * 10000 / prev.sdg_per_usd_e6 > tn.max_rate_move_bps then
    raise exception 'the pound rate moves more than % percent against % (% SDG per dollar); check the number or raise the limit in settings',
      round(tn.max_rate_move_bps / 100.0, 1), prev.rate_date, round(prev.sdg_per_usd_e6 / 1000000.0, 2)
      using errcode = 'P0001';
  end if;
  if found and abs(new.eur_per_usd_e6 - prev.eur_per_usd_e6)::numeric * 10000 / prev.eur_per_usd_e6 > tn.max_rate_move_bps then
    raise exception 'the euro rate moves more than % percent against %; check the number', round(tn.max_rate_move_bps / 100.0, 1), prev.rate_date
      using errcode = 'P0001';
  end if;
  return new;
end $$;
