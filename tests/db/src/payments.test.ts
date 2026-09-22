import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWorld, workedExampleLines, type World } from './fixture';

let w: World;
let orderId: string;
beforeAll(async () => {
  w = await buildWorld('payments');
  const { data, error } = await w.users.sales.client.rpc('create_order', {
    p_tenant_id: w.tenantId,
    p_customer_id: w.customerId,
    p_lines: workedExampleLines(w),
  });
  if (error) throw error;
  orderId = data;
});
afterAll(async () => w?.cleanup());

let tx = 0;
const pay = (amount: number, opts: { account?: string; code?: string; allocate?: number; day?: string } = {}) =>
  w.users.sales.client.rpc('record_payment', {
    p_bank_account_id: opts.account ?? w.accounts[0],
    p_bank_tx_code: opts.code ?? `TX-${++tx}`,
    p_amount_sdg: amount,
    p_customer_id: w.customerId,
    p_allocations: opts.allocate ? [{ order_id: orderId, amount_sdg: opts.allocate }] : [],
    p_received_on: opts.day ?? null,
  });

describe('record_payment', () => {
  it('rejects a single transfer above 3,000,000 SDG', async () => {
    const { error } = await pay(3_000_001);
    expect(error?.message).toMatch(/cannot exceed 3000000/);
  });

  it('records a bank transaction code only once per account', async () => {
    expect((await pay(1_000, { code: 'DUP-1' })).error).toBeNull();
    const again = await pay(1_000, { code: 'DUP-1' });
    expect(again.error?.message).toMatch(/already recorded/);
    // the same code on a different bank is a different transfer
    expect((await pay(1_000, { code: 'DUP-1', account: w.accounts[1] })).error).toBeNull();
  });

  it('stops an account at its 15,000,000 SDG daily limit and says how much is left', async () => {
    const account = w.accounts[2];
    for (let i = 0; i < 5; i++) expect((await pay(3_000_000, { account })).error).toBeNull();
    const over = await pay(1, { account });
    expect(over.error?.message).toMatch(/can only receive 0 SDG more/);

    const { data } = await w.users.sales.client.from('bank_account_status').select('received_today_sdg, remaining_today_sdg').eq('bank_account_id', account).single();
    expect(data).toEqual({ received_today_sdg: 15_000_000, remaining_today_sdg: 0 });
  });

  it('values a transfer at the rate of the day it arrived and books the currency result', async () => {
    // 2,000,000 SDG received yesterday at 7,900 against an order booked today at 8,012.5
    const { error } = await pay(2_000_000, { allocate: 2_000_000, day: prevDay(w.today), account: w.accounts[3] });
    expect(error).toBeNull();
    const { data } = await w.users.owner.client
      .from('payment_allocations')
      .select('booked_usd_cents, realized_usd_cents, fx_result_usd_cents, fx_result_eur_cents')
      .eq('order_id', orderId)
      .single();
    // 2,000,000 / 7,900 = $253.16 ; 2,000,000 / 8,012.5 = $249.61 ; gain $3.55 = €3.26 at 0.918
    expect(data).toEqual({ booked_usd_cents: 24961, realized_usd_cents: 25316, fx_result_usd_cents: 355, fx_result_eur_cents: 326 });
  });

  it('never lets an order be paid more than its total', async () => {
    const { data: o } = await w.users.sales.client.from('orders').select('total_sdg, paid_sdg').eq('id', orderId).single();
    const { error } = await pay(3_000_000, { account: w.accounts[4], allocate: o!.total_sdg - o!.paid_sdg + 1 });
    expect(error).not.toBeNull();
  });

  it('keeps recorded payments immutable', async () => {
    await expect(w.db.query(`update payments set amount_sdg = 1 where tenant_id = $1`, [w.tenantId])).rejects.toThrow(/cannot change/);
  });
});

describe('release_order', () => {
  it('refuses to release goods until the order is fully paid, then releases and moves stock', async () => {
    const early = await w.users.warehouse.client.rpc('release_order', { p_order_id: orderId });
    expect(early.error?.message).toMatch(/not fully paid/);

    // pay the rest in transfers of at most 3,000,000, spreading over accounts
    let { data: o } = await w.users.sales.client.from('orders').select('total_sdg, paid_sdg').eq('id', orderId).single();
    const withRoom = [0, 1, 3, 4, 5].map((i) => w.accounts[i]); // account 2 is full for today
    while (o!.paid_sdg < o!.total_sdg) {
      const amount = Math.min(3_000_000, o!.total_sdg - o!.paid_sdg);
      const r = await pay(amount, { account: withRoom[0], allocate: amount });
      if (r.error?.message.match(/can only receive/)) {
        withRoom.shift();
        expect(withRoom.length).toBeGreaterThan(0);
        continue;
      }
      expect(r.error).toBeNull();
      ({ data: o } = await w.users.sales.client.from('orders').select('total_sdg, paid_sdg').eq('id', orderId).single());
    }

    const bySales = await w.users.sales.client.rpc('release_order', { p_order_id: orderId });
    expect(bySales.error?.message).toMatch(/only the warehouse/);

    const release = await w.users.warehouse.client.rpc('release_order', { p_order_id: orderId });
    expect(release.error).toBeNull();

    const { data: stock } = await w.users.warehouse.client.from('stock_levels').select('sku, on_hand').order('sku');
    expect(stock).toEqual([
      { sku: 'BAT', on_hand: 18 },
      { sku: 'INV', on_hand: 46 },
    ]);

    const twice = await w.users.warehouse.client.rpc('release_order', { p_order_id: orderId });
    expect(twice.error?.message).toMatch(/already been released/);
  });
});

function prevDay(d: string) {
  const t = new Date(d + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}
