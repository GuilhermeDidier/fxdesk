export interface CustomerOrder {
  customer_id: string;
  status: string;
  booked_on: string;
  total_usd_cents: number;
  total_sdg: number;
  paid_sdg: number;
  converted_to?: string | null;
}

export interface CustomerSummary {
  orders: number;
  openQuotes: number;
  boughtUsdCents: number;
  openSdg: number;
  lastOrderOn: string | null;
}

const EMPTY: CustomerSummary = { orders: 0, openQuotes: 0, boughtUsdCents: 0, openSdg: 0, lastOrderOn: null };

/** Per-customer totals from booked orders only; quotes are counted apart, cancellations ignored. */
export function summarizeCustomers(orders: CustomerOrder[]): Map<string, CustomerSummary> {
  const out = new Map<string, CustomerSummary>();
  for (const o of orders) {
    const s = { ...(out.get(o.customer_id) ?? EMPTY) };
    if (o.status === 'quote') {
      if (!o.converted_to) s.openQuotes += 1;
    } else if (o.status === 'confirmed') {
      s.orders += 1;
      s.boughtUsdCents += o.total_usd_cents;
      s.openSdg += o.total_sdg - o.paid_sdg;
      if (!s.lastOrderOn || o.booked_on > s.lastOrderOn) s.lastOrderOn = o.booked_on;
    }
    out.set(o.customer_id, s);
  }
  return out;
}

export const summaryFor = (m: Map<string, CustomerSummary>, id: string) => m.get(id) ?? EMPTY;

/** CRM labels: short, lowercase, hyphenated, no duplicates. */
export function normalizeLabels(input: string[]): string[] {
  const clean = input
    .map((l) => l.trim().toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24))
    .filter(Boolean);
  return [...new Set(clean)].slice(0, 12);
}
