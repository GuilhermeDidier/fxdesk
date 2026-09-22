import { normalizeLabels, summarizeCustomers, summaryFor } from './customers';

describe('summarizeCustomers', () => {
  const m = summarizeCustomers([
    { customer_id: 'a', status: 'confirmed', booked_on: '2026-09-01', total_usd_cents: 100_00, total_sdg: 800_000, paid_sdg: 800_000 },
    { customer_id: 'a', status: 'confirmed', booked_on: '2026-09-10', total_usd_cents: 50_00, total_sdg: 400_000, paid_sdg: 100_000 },
    { customer_id: 'a', status: 'cancelled', booked_on: '2026-09-12', total_usd_cents: 999_00, total_sdg: 1, paid_sdg: 0 },
    { customer_id: 'a', status: 'quote', booked_on: '2026-09-15', total_usd_cents: 70_00, total_sdg: 1, paid_sdg: 0 },
    { customer_id: 'a', status: 'quote', booked_on: '2026-09-02', total_usd_cents: 70_00, total_sdg: 1, paid_sdg: 0, converted_to: 'x' },
  ]);

  it('adds up booked orders only, and counts open quotes apart', () => {
    expect(summaryFor(m, 'a')).toEqual({ orders: 2, openQuotes: 1, boughtUsdCents: 150_00, openSdg: 300_000, lastOrderOn: '2026-09-10' });
  });

  it('returns an empty summary for a customer with no orders', () => {
    expect(summaryFor(m, 'nobody').orders).toBe(0);
  });
});

describe('normalizeLabels', () => {
  it('makes labels consistent and unique', () => {
    expect(normalizeLabels([' VIP ', 'vip', 'Slow payer', '', '--pumps--'])).toEqual(['vip', 'slow-payer', 'pumps']);
  });

  it('keeps Arabic labels for the RTL interface later', () => {
    expect(normalizeLabels(['موزع'])).toEqual(['موزع']);
  });
});
