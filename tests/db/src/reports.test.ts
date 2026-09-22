import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWorld, workedExampleLines, type World } from './fixture';

let w: World;
beforeAll(async () => {
  w = await buildWorld('reports');
  const { data: orderId, error } = await w.users.sales.client.rpc('create_order', {
    p_tenant_id: w.tenantId,
    p_customer_id: w.customerId,
    p_lines: workedExampleLines(w),
  });
  if (error) throw error;
  const pay = await w.users.sales.client.rpc('record_payment', {
    p_bank_account_id: w.accounts[0],
    p_bank_tx_code: 'R-1',
    p_amount_sdg: 3_000_000,
    p_customer_id: w.customerId,
    p_allocations: [{ order_id: orderId, amount_sdg: 3_000_000 }],
  });
  if (pay.error) throw pay.error;
});
afterAll(async () => w?.cleanup());

const snapshot = async () => {
  const views = ['order_profit', 'line_profit', 'profit_by_period'];
  const out: Record<string, unknown> = {};
  for (const v of views) {
    const { data } = await w.users.owner.client.from(v).select('*');
    out[v] = [...(data ?? [])].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return out;
};

describe('a report run today gives the same numbers later', () => {
  it('is unchanged after prices, costs and rates move', async () => {
    const before = await snapshot();
    expect((before.order_profit as unknown[]).length).toBe(1);

    // the world moves on: new list price, a pricier shipment changes the average cost,
    // and a new rate is entered for tomorrow
    await w.users.owner.client.from('products').update({ price_usd_cents: 199900 }).eq('id', w.products.inverter);
    const { rows: [sh] } = await w.db.query(`insert into shipments (tenant_id, reference, supplier) values ($1, 'SH-2', 'S') returning id`, [w.tenantId]);
    await w.db.query(`insert into shipment_lines (shipment_id, tenant_id, product_id, qty, unit_cost_usd_cents) values ($1, $2, $3, 10, 150000)`, [sh.id, w.tenantId, w.products.inverter]);
    const closed = await w.users.owner.client.rpc('close_shipment', { p_shipment_id: sh.id });
    expect(closed.error).toBeNull();
    await w.db.query(`insert into fx_rates (tenant_id, rate_date, sdg_per_usd_e6, eur_per_usd_e6) values ($1, $2::date + 1, 9500000000, 850000)`, [w.tenantId, w.today]);

    expect(await snapshot()).toEqual(before);
  });

  it('will not let a rate that is already used be edited', async () => {
    await expect(
      w.db.query(`update fx_rates set sdg_per_usd_e6 = 1 where tenant_id = $1 and rate_date = $2`, [w.tenantId, w.today]),
    ).rejects.toThrow(/already used/);
  });

  it('will not let a closed shipment be edited, so landed costs cannot shift under old sales', async () => {
    await expect(
      w.db.query(`update shipment_charges set amount_usd_cents = 0 where tenant_id = $1`, [w.tenantId]),
    ).rejects.toThrow(/closed/);
  });

  it('spreads shipment charges to the cent', async () => {
    const { data } = await w.users.owner.client.from('shipment_lines').select('allocated_charges_usd_cents, shipment:shipments!inner(reference)').eq('shipment.reference', 'SH-1');
    expect(data!.reduce((s, l) => s + l.allocated_charges_usd_cents!, 0)).toBe(150001);
  });
});
