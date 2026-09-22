import { WORKED_EXAMPLE } from '@fxdesk/money';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWorld, workedExampleLines, type World } from './fixture';

let w: World;
beforeAll(async () => {
  w = await buildWorld('orders');
});
afterAll(async () => w?.cleanup());

const book = (client: World['users']['sales']['client'], lines: object[]) =>
  client.rpc('create_order', { p_tenant_id: w.tenantId, p_customer_id: w.customerId, p_lines: lines });

describe('create_order', () => {
  it('books the worked example with exactly the numbers the TypeScript preview shows', async () => {
    const { data: id, error } = await book(w.users.sales.client, workedExampleLines(w));
    expect(error).toBeNull();

    const { data: order } = await w.users.sales.client
      .from('orders')
      .select('status, total_usd_cents, total_sdg, total_eur_cents, sdg_per_usd_e6, eur_per_usd_e6, lines:order_lines(gross_usd_cents, discount_usd_cents, net_usd_cents)')
      .eq('id', id)
      .order('position', { referencedTable: 'order_lines' })
      .single();

    expect(order).toMatchObject({
      status: 'confirmed',
      total_usd_cents: WORKED_EXAMPLE.expected.totalUsdCents,
      total_sdg: WORKED_EXAMPLE.expected.totalSdg,
      total_eur_cents: WORKED_EXAMPLE.expected.totalEurCents,
      sdg_per_usd_e6: WORKED_EXAMPLE.rates.sdgPerUsdE6,
      eur_per_usd_e6: WORKED_EXAMPLE.rates.eurPerUsdE6,
    });
    expect(order!.lines.map((l) => [l.gross_usd_cents, l.discount_usd_cents, l.net_usd_cents])).toEqual(WORKED_EXAMPLE.expected.lines);
  });

  it('prices from the catalogue and ignores any price sent by the client', async () => {
    const { data: id } = await book(w.users.sales.client, [{ product_id: w.products.inverter, qty: 1, discount_bps: 0, unit_price_usd_cents: 1 }]);
    const { data } = await w.users.sales.client.from('orders').select('total_usd_cents').eq('id', id).single();
    expect(data!.total_usd_cents).toBe(124900);
  });

  it('holds a discount above the red band for the owner, and only the owner can approve it', async () => {
    const { data: id } = await book(w.users.sales.client, [{ product_id: w.products.inverter, qty: 1, discount_bps: 501 }]);
    const status = async () => (await w.users.owner.client.from('orders').select('status').eq('id', id).single()).data!.status;
    expect(await status()).toBe('pending_approval');

    const bySales = await w.users.sales.client.rpc('approve_order', { p_order_id: id });
    expect(bySales.error?.message).toMatch(/only the owner/);
    expect(await status()).toBe('pending_approval');

    const byOwner = await w.users.owner.client.rpc('approve_order', { p_order_id: id });
    expect(byOwner.error).toBeNull();
    expect(await status()).toBe('confirmed');
  });

  it('refuses orders from the warehouse role', async () => {
    const { error } = await book(w.users.warehouse.client, workedExampleLines(w));
    expect(error?.message).toMatch(/only owners and sales advisers/);
  });

  it('cannot be written or edited through the REST API', async () => {
    const insert = await w.users.owner.client.from('orders').insert({ tenant_id: w.tenantId, number: 999 });
    expect(insert.error).not.toBeNull();

    const { data: any } = await w.users.owner.client.from('orders').select('id, total_usd_cents').limit(1).single();
    const update = await w.users.owner.client.from('orders').update({ total_usd_cents: 1 }).eq('id', any!.id).select();
    expect(update.data ?? []).toHaveLength(0);
    const { data: after } = await w.users.owner.client.from('orders').select('total_usd_cents').eq('id', any!.id).single();
    expect(after!.total_usd_cents).toBe(any!.total_usd_cents);
  });

  it('keeps booked amounts immutable even for a database superuser', async () => {
    const { rows } = await w.db.query('select id from orders where tenant_id = $1 limit 1', [w.tenantId]);
    await expect(w.db.query('update orders set total_usd_cents = 1 where id = $1', [rows[0].id])).rejects.toThrow(/cannot change/);
    await expect(w.db.query('delete from order_lines where order_id = $1', [rows[0].id])).rejects.toThrow(/not allowed/);
  });
});
