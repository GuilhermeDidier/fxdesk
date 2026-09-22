-- Demo history for one tenant. Run by scripts/seed.ts after it has created the
-- users; expects seed.tenant, seed.owner, seed.sales, seed.sales2, seed.warehouse
-- to be set. Deterministic (setseed) so every reseed tells the same story.
--
-- Everything is booked through the same private.book_order / book_payment /
-- close_shipment code the app calls, just with past dates.

do $$
declare
  t        uuid := current_setting('seed.tenant')::uuid;
  owner    uuid := current_setting('seed.owner')::uuid;
  advisers uuid[] := array[current_setting('seed.sales')::uuid, current_setting('seed.sales2')::uuid];
  today    date := private.today(current_setting('seed.tenant')::uuid);
  d        int;
  day      date;
  rate     numeric;
  cust     uuid[];
  prod     record;
  accts    uuid[];
  o        public.orders;
  oid      uuid;
  n_lines  int;
  lines    jsonb;
  pay_day  date;
  left_sdg bigint;
  amt      bigint;
  tx       int := 40000;
  placed   boolean;
  a        uuid;
  used     bigint;
begin
  perform setseed(0.42);
  perform set_config('request.jwt.claim.sub', owner::text, true);

  -- rates: the pound slides from ~6,050 to ~8,000 per dollar over 90 days
  for d in reverse 90..0 loop
    day := today - d;
    rate := 6050 * power(8000.0 / 6050, (90 - d) / 90.0) + 40 * sin(d / 3.0) + (random() - 0.5) * 30;
    insert into public.fx_rates (tenant_id, rate_date, sdg_per_usd_e6, eur_per_usd_e6, source, created_by)
    values (t, day, (round(rate * 2) / 2 * 1000000)::bigint,
            (round((0.918 + 0.012 * sin(d / 11.0)) * 10000) * 100)::bigint, 'seed', owner);
  end loop;

  insert into public.products (tenant_id, sku, name, category, price_usd_cents, min_stock) values
    (t, 'INV-H5',   'Hybrid inverter 5 kW',        'inverter',  64900, 10),
    (t, 'INV-H10',  'Hybrid inverter 10 kW',       'inverter', 124900,  6),
    (t, 'BAT-L5',   'Lithium battery 5.12 kWh',    'battery',   89000, 10),
    (t, 'BAT-L10',  'Lithium battery 10 kWh',      'battery',  189050,  4),
    (t, 'PNL-M550', 'Mono panel 550 W',            'panel',      9800, 80),
    (t, 'PNL-M450', 'Mono panel 450 W',            'panel',      7900, 60),
    (t, 'PMP-S2',   'Solar pump kit 2 HP',         'pump',      72000,  4),
    (t, 'PMP-S5',   'Solar pump kit 5 HP',         'pump',     145000,  2),
    (t, 'CTL-60',   'MPPT charge controller 60 A', 'other',     11500, 15);

  insert into public.customers (tenant_id, name, phone, city, labels) values
    (t, 'Al-Amal Solar',            '+249 91 200 1101', 'Port Sudan',  '{dealer,vip}'),
    (t, 'Nile Light Installers',    '+249 91 200 1102', 'Atbara',      '{installer}'),
    (t, 'Kassala Power House',      '+249 91 200 1103', 'Kassala',     '{dealer}'),
    (t, 'Gezira Agri Pumps',        '+249 91 200 1104', 'Wad Madani',  '{dealer,pumps}'),
    (t, 'Kordofan Sun Co.',         '+249 91 200 1105', 'El Obeid',    '{dealer}'),
    (t, 'Dongola Green Energy',     '+249 91 200 1106', 'Dongola',     '{installer,new}'),
    (t, 'Gedaref Solar Services',   '+249 91 200 1107', 'Gedaref',     '{installer}'),
    (t, 'Red Sea Electric',         '+249 91 200 1108', 'Port Sudan',  '{dealer,slow-payer}');
  select array_agg(id order by name) into cust from public.customers where tenant_id = t;

  insert into public.bank_accounts (tenant_id, name, bank) values
    (t, 'BOK · operations',   'Bank of Khartoum'),
    (t, 'BOK · collections',  'Bank of Khartoum'),
    (t, 'Faisal · main',      'Faisal Islamic Bank'),
    (t, 'Omdurman · main',    'Omdurman National Bank'),
    (t, 'Blue Nile · main',   'Blue Nile Mashreq Bank');
  select array_agg(id order by name) into accts from public.bank_accounts where tenant_id = t;

  -- shipments: two closed (costs spread per unit), one still in transit
  insert into public.shipments (tenant_id, reference, supplier, arrived_on) values
    (t, 'SHP-2406', 'Shenzhen Solar Trading', today - 84),
    (t, 'SHP-2407', 'Shenzhen Solar Trading', today - 38),
    (t, 'SHP-2408', 'Ningbo Energy Export',   null);

  insert into public.shipment_lines (shipment_id, tenant_id, product_id, qty, unit_cost_usd_cents)
  select s.id, t, p.id, q.qty, q.cost
  from (values
    ('SHP-2406','INV-H5',60,41200),('SHP-2406','INV-H10',30,82500),('SHP-2406','BAT-L5',50,56800),
    ('SHP-2406','BAT-L10',20,125000),('SHP-2406','PNL-M550',600,5600),('SHP-2406','PNL-M450',400,4500),
    ('SHP-2406','PMP-S2',15,46000),('SHP-2406','PMP-S5',8,98000),('SHP-2406','CTL-60',80,6200),
    ('SHP-2407','INV-H5',50,42900),('SHP-2407','INV-H10',25,85100),('SHP-2407','BAT-L5',40,58200),
    ('SHP-2407','BAT-L10',16,128900),('SHP-2407','PNL-M550',500,5750),('SHP-2407','PMP-S2',10,47500),
    ('SHP-2407','CTL-60',60,6400),
    ('SHP-2408','INV-H10',40,86000),('SHP-2408','BAT-L10',30,131000),('SHP-2408','PNL-M550',800,5800)
  ) as q(ref, sku, qty, cost)
  join public.shipments s on s.reference = q.ref and s.tenant_id = t
  join public.products p on p.sku = q.sku and p.tenant_id = t;

  insert into public.shipment_charges (shipment_id, tenant_id, kind, amount_usd_cents, note)
  select s.id, t, c.kind, c.amount, c.note
  from (values
    ('SHP-2406','freight',  1860000, '2 x 40ft Shenzhen to Port Sudan'),
    ('SHP-2406','customs',  2415000, 'Port Sudan customs + VAT'),
    ('SHP-2406','transport', 520000, 'Port Sudan to warehouse'),
    ('SHP-2407','freight',  2140000, '2 x 40ft, Red Sea surcharge'),
    ('SHP-2407','customs',  2238000, 'Port Sudan customs + VAT'),
    ('SHP-2407','transport', 610000, 'Port Sudan to warehouse'),
    ('SHP-2408','freight',  2300000, 'booked, not yet invoiced')
  ) as c(ref, kind, amount, note)
  join public.shipments s on s.reference = c.ref and s.tenant_id = t;

  perform public.close_shipment(id) from public.shipments where tenant_id = t and reference = 'SHP-2406';

  -- orders, day by day
  for d in reverse 82..0 loop
    day := today - d;
    if d = 38 then
      perform public.close_shipment(id) from public.shipments where tenant_id = t and reference = 'SHP-2407';
    end if;
    continue when random() < 0.45;

    n_lines := 1 + floor(random() * 3)::int;
    select jsonb_agg(jsonb_build_object(
             'product_id', p.id,
             'qty', case when p.category = 'panel' then 10 + floor(random() * 40)::int
                         when p.category = 'pump' then 1 + floor(random() * 2)::int
                         else 1 + floor(random() * 5)::int end,
             'discount_bps', (array[0, 0, 100, 200, 250, 300, 400, 500, 500, 650])[1 + floor(random() * 10)::int]))
      into lines
      from (select id, category from public.products where tenant_id = t order by random() limit n_lines) p;

    oid := private.book_order(t, cust[1 + floor(random() * array_length(cust, 1))::int],
                              advisers[1 + floor(random() * 2)::int], day, lines, null);
    select * into o from public.orders where id = oid;

    if o.status = 'pending_approval' and d > 2 then
      update public.orders set status = 'confirmed', approved_by = owner, approved_at = day + time '17:00'
       where id = o.id returning * into o;
    end if;
    continue when o.status <> 'confirmed';

    -- the dealer pays in transfers of at most 3,000,000 SDG over the next days,
    -- into whichever account still has room that day; slow payers take longer
    pay_day := day + floor(random() * 4)::int
               + case when o.customer_id = cust[array_length(cust, 1)] then 8 else 0 end;
    left_sdg := o.total_sdg;
    if d < 6 and random() < 0.6 then
      left_sdg := left_sdg / 2;   -- recent orders are still being paid
    end if;
    while left_sdg > 0 and pay_day <= today loop
      amt := least(3000000, left_sdg);
      placed := false;
      foreach a in array accts loop
        select coalesce(sum(amount_sdg), 0) into used from public.payments
         where bank_account_id = a and received_on = pay_day;
        if used + amt <= 15000000 then
          tx := tx + 1 + floor(random() * 50)::int;
          perform private.book_payment(a, 'TRX' || lpad(tx::text, 8, '0'), amt, o.customer_id,
                    jsonb_build_array(jsonb_build_object('order_id', o.id, 'amount_sdg', amt)),
                    pay_day, null, advisers[1]);
          left_sdg := left_sdg - amt;
          placed := true;
          exit;
        end if;
      end loop;
      if not placed or random() < 0.25 then
        pay_day := pay_day + 1;
      end if;
    end loop;

    -- the warehouse releases fully paid orders a day after the last payment
    select * into o from public.orders where id = o.id;
    if o.paid_sdg = o.total_sdg and pay_day < today and not exists (
         select 1 from public.order_lines l where l.order_id = o.id
          and l.qty > (select coalesce(sum(m.qty), 0) from public.stock_movements m where m.product_id = l.product_id)) then
      insert into public.stock_movements (tenant_id, product_id, qty, kind, order_id, created_by)
      select t, product_id, -sum(qty)::int, 'release', o.id, owner
        from public.order_lines where order_id = o.id group by product_id;
      update public.orders set released_at = pay_day + 1 + time '10:00', released_by = owner where id = o.id;
    end if;
  end loop;
end $$;
