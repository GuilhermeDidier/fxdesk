import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonKey, buildWorld, url, workedExampleLines, type World } from './fixture';

let w: World;
let other: World;
beforeAll(async () => {
  w = await buildWorld('rls');
  other = await buildWorld('rls-other');
  // one booked order in each tenant so cost snapshots exist
  for (const x of [w, other]) {
    const { error } = await x.users.sales.client.rpc('create_order', {
      p_tenant_id: x.tenantId,
      p_customer_id: x.customerId,
      p_lines: workedExampleLines(x),
    });
    if (error) throw error;
  }
});
afterAll(async () => {
  await w?.cleanup();
  await other?.cleanup();
});

const COST_SOURCES = [
  'product_costs',
  'order_line_costs',
  'shipments',
  'shipment_lines',
  'shipment_charges',
  'order_profit',
  'line_profit',
  'profit_by_period',
];

describe('a sales adviser can never see a cost price', () => {
  it.each(COST_SOURCES)('%s returns no rows to sales, even queried directly', async (table) => {
    const { data, error } = await w.users.sales.client.from(table).select('*');
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it.each(COST_SOURCES)('%s does return rows to the owner', async (table) => {
    const { data } = await w.users.owner.client.from(table).select('*');
    expect(data!.length).toBeGreaterThan(0);
  });

  it('products and order lines carry no cost column at all', async () => {
    const { data: p } = await w.users.sales.client.from('products').select('*').limit(1).single();
    const { data: l } = await w.users.sales.client.from('order_lines').select('*').limit(1).single();
    for (const row of [p, l]) {
      expect(Object.keys(row!).filter((k) => k.includes('cost'))).toEqual([]);
    }
  });
});

describe('roles', () => {
  it('warehouse cannot see payments or bank accounts', async () => {
    for (const table of ['payments', 'payment_allocations', 'bank_accounts', 'bank_account_status']) {
      const { data } = await w.users.warehouse.client.from(table).select('*');
      expect(data, table).toEqual([]);
    }
  });

  it('only the owner sets exchange rates', async () => {
    const { error } = await w.users.sales.client
      .from('fx_rates')
      .insert({ tenant_id: w.tenantId, rate_date: '2000-01-01', sdg_per_usd_e6: 1, eur_per_usd_e6: 1 });
    expect(error).not.toBeNull();
  });

  it('sales cannot change catalogue prices', async () => {
    await w.users.sales.client.from('products').update({ price_usd_cents: 1 }).eq('id', w.products.inverter);
    const { data } = await w.users.owner.client.from('products').select('price_usd_cents').eq('id', w.products.inverter).single();
    expect(data!.price_usd_cents).toBe(124900);
  });
});

describe('tenants are isolated', () => {
  it('a user sees nothing of another tenant', async () => {
    for (const table of ['orders', 'customers', 'products', 'fx_rates', 'order_profit']) {
      const { data } = await w.users.owner.client.from(table).select('tenant_id');
      expect(new Set((data ?? []).map((r) => r.tenant_id)), table).toEqual(new Set([w.tenantId]));
    }
  });

  it('cannot book into another tenant', async () => {
    const { error } = await w.users.sales.client.rpc('create_order', {
      p_tenant_id: other.tenantId,
      p_customer_id: other.customerId,
      p_lines: workedExampleLines(other),
    });
    expect(error).not.toBeNull();
  });

  it('anonymous visitors get nothing', async () => {
    const anon = createClient(url(), anonKey(), { auth: { persistSession: false } });
    for (const table of ['orders', 'products', 'fx_rates', 'order_profit', 'tenants']) {
      const { data } = await anon.from(table).select('*');
      expect(data ?? [], table).toEqual([]);
    }
  });
});
