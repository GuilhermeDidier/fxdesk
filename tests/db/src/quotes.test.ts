import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWorld, workedExampleLines, type World } from './fixture';

let w: World;
beforeAll(async () => {
  w = await buildWorld('quotes');
});
afterAll(async () => w?.cleanup());

const quote = () =>
  w.users.sales.client.rpc('create_quote', { p_tenant_id: w.tenantId, p_customer_id: w.customerId, p_lines: workedExampleLines(w) });

describe('quotes', () => {
  it('are priced like an order but take no money and reach no report', async () => {
    const { data: id, error } = await quote();
    expect(error).toBeNull();
    const { data: q } = await w.users.owner.client.from('orders').select('status, total_sdg').eq('id', id).single();
    expect(q).toEqual({ status: 'quote', total_sdg: 68_161_777 });

    const pay = await w.users.sales.client.rpc('record_payment', {
      p_bank_account_id: w.accounts[0],
      p_bank_tx_code: 'Q-1',
      p_amount_sdg: 1_000,
      p_customer_id: w.customerId,
      p_allocations: [{ order_id: id, amount_sdg: 1_000 }],
    });
    expect(pay.error?.message).toMatch(/not confirmed/);

    const { data: profit } = await w.users.owner.client.from('order_profit').select('order_id').eq('order_id', id);
    expect(profit).toEqual([]);
  });

  it('turn into an order once, re-priced from the catalogue on the day of acceptance', async () => {
    const { data: id } = await quote();
    await w.users.owner.client.from('products').update({ price_usd_cents: 130000 }).eq('id', w.products.inverter);

    const { data: orderId, error } = await w.users.sales.client.rpc('convert_quote', { p_quote_id: id });
    expect(error).toBeNull();
    const { data: order } = await w.users.sales.client.from('orders').select('status, quoted_from, total_usd_cents').eq('id', orderId).single();
    // 4 x 1,300.00 less 2% = 5,096.00 ; batteries unchanged 3,610.85
    expect(order).toEqual({ status: 'confirmed', quoted_from: id, total_usd_cents: 870_685 });

    const { data: q } = await w.users.sales.client.from('orders').select('converted_to, total_usd_cents').eq('id', id).single();
    expect(q).toEqual({ converted_to: orderId, total_usd_cents: 850_693 });

    const again = await w.users.sales.client.rpc('convert_quote', { p_quote_id: id });
    expect(again.error?.message).toMatch(/already been turned into an order/);
  });

  it('cannot be written or converted by marketing or the warehouse', async () => {
    for (const role of ['marketing', 'warehouse'] as const) {
      const { error } = await w.users[role].client.rpc('create_quote', { p_tenant_id: w.tenantId, p_customer_id: w.customerId, p_lines: workedExampleLines(w) });
      expect(error, role).not.toBeNull();
    }
  });
});

describe('marketing', () => {
  it('keeps the customer list but never sees money or costs', async () => {
    const m = w.users.marketing.client;
    const add = await m.from('customers').insert({ tenant_id: w.tenantId, name: 'New Dealer', labels: ['new'] }).select('id').single();
    expect(add.error).toBeNull();
    const label = await m.from('customers').update({ labels: ['new', 'vip'] }).eq('id', add.data!.id).select('labels').single();
    expect(label.data?.labels).toEqual(['new', 'vip']);

    for (const table of ['payments', 'bank_account_status', 'order_line_costs', 'product_costs', 'order_profit']) {
      const { data } = await m.from(table).select('*');
      expect(data ?? [], table).toEqual([]);
    }
    const book = await m.rpc('create_order', { p_tenant_id: w.tenantId, p_customer_id: w.customerId, p_lines: workedExampleLines(w) });
    expect(book.error).not.toBeNull();
  });
});
