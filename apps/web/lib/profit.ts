import { createHash } from 'node:crypto';

export type Ccy = 'usd' | 'eur';

export interface PeriodRow {
  period_start: string;
  orders: number;
  revenue_usd_cents: number;
  cost_usd_cents: number;
  fx_usd_cents: number;
  revenue_eur_cents: number;
  cost_eur_cents: number;
  fx_eur_cents: number;
}

export interface LineRow {
  order_id: string;
  product_id: string;
  product_name: string;
  sku: string;
  customer_id: string;
  customer_name: string;
  qty: number;
  revenue_usd_cents: number;
  cost_usd_cents: number;
  revenue_eur_cents: number;
  cost_eur_cents: number;
}

export interface Figures {
  key: string;
  label: string;
  sub?: string;
  count: number;
  revenue: number;
  cost: number;
  fx: number | null;
  fingerprint?: string;
}

/**
 * A short digest of a period's stored integers. The same fingerprint on a
 * later run proves the period did not change by a single cent.
 */
export function fingerprint(r: PeriodRow): string {
  return createHash('sha256')
    .update(JSON.stringify([r.period_start, r.orders, r.revenue_usd_cents, r.cost_usd_cents, r.fx_usd_cents, r.revenue_eur_cents, r.cost_eur_cents, r.fx_eur_cents]))
    .digest('hex')
    .slice(0, 12);
}

/** Group line margins by product or by customer, best margin first. */
export function groupLines(lines: LineRow[], by: 'product' | 'customer', ccy: Ccy): Figures[] {
  const groups = new Map<string, Figures & { orders: Set<string> }>();
  for (const r of lines) {
    const key = by === 'product' ? r.product_id : r.customer_id;
    const g = groups.get(key) ?? {
      key,
      label: by === 'product' ? r.product_name : r.customer_name,
      sub: by === 'product' ? r.sku : undefined,
      count: 0,
      revenue: 0,
      cost: 0,
      fx: null,
      orders: new Set<string>(),
    };
    g.orders.add(r.order_id);
    g.count = by === 'product' ? g.count + r.qty : g.orders.size;
    g.revenue += ccy === 'usd' ? r.revenue_usd_cents : r.revenue_eur_cents;
    g.cost += ccy === 'usd' ? r.cost_usd_cents : r.cost_eur_cents;
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(({ orders: _orders, ...f }) => f)
    .sort((a, b) => b.revenue - b.cost - (a.revenue - a.cost));
}

export function marginPct(f: Pick<Figures, 'revenue' | 'cost'>): string {
  return f.revenue ? (((f.revenue - f.cost) / f.revenue) * 100).toFixed(1) + '%' : '';
}
