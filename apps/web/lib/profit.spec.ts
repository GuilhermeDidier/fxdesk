import { fingerprint, groupLines, marginPct, type LineRow, type PeriodRow } from './profit';

const period: PeriodRow = {
  period_start: '2026-08-01',
  orders: 17,
  revenue_usd_cents: 9_555_500,
  cost_usd_cents: 8_239_900,
  fx_usd_cents: -189_300,
  revenue_eur_cents: 8_770_000,
  cost_eur_cents: 7_560_000,
  fx_eur_cents: -173_000,
};

describe('fingerprint', () => {
  it('is stable for the same stored numbers', () => {
    expect(fingerprint(period)).toBe(fingerprint({ ...period }));
    expect(fingerprint(period)).toMatch(/^[0-9a-f]{12}$/);
  });

  it('changes if a single cent moves', () => {
    expect(fingerprint({ ...period, fx_eur_cents: period.fx_eur_cents + 1 })).not.toBe(fingerprint(period));
  });
});

describe('groupLines', () => {
  const line = (o: string, p: string, c: string, qty: number, rev: number, cost: number): LineRow => ({
    order_id: o, product_id: p, product_name: p, sku: p, customer_id: c, customer_name: c, qty,
    revenue_usd_cents: rev, cost_usd_cents: cost, revenue_eur_cents: rev - 1, cost_eur_cents: cost - 1,
  });
  const lines = [line('o1', 'INV', 'A', 2, 1000, 700), line('o2', 'INV', 'B', 1, 500, 350), line('o2', 'BAT', 'B', 1, 900, 800)];

  it('counts units per product and orders per customer', () => {
    expect(groupLines(lines, 'product', 'usd').map((g) => [g.key, g.count, g.revenue, g.cost])).toEqual([
      ['INV', 3, 1500, 1050],
      ['BAT', 1, 900, 800],
    ]);
    expect(groupLines(lines, 'customer', 'usd').find((g) => g.key === 'B')?.count).toBe(1);
  });

  it('uses the stored euro figures, not a conversion', () => {
    expect(groupLines(lines, 'product', 'eur')[0].revenue).toBe(1498);
  });

  it('formats margins and leaves them empty without sales', () => {
    expect(marginPct({ revenue: 1000, cost: 700 })).toBe('30.0%');
    expect(marginPct({ revenue: 0, cost: 0 })).toBe('');
  });
});
