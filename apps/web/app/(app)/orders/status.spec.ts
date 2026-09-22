import { orderStage } from './status';

const base = { status: 'confirmed', total_sdg: 1000, paid_sdg: 0, released_at: null } as const;

describe('orderStage', () => {
  it.each([
    [{ ...base, status: 'pending_approval' }, 'Needs approval'],
    [{ ...base, status: 'cancelled' }, 'Cancelled'],
    [{ ...base, status: 'quote' }, 'Quote'],
    [{ ...base, status: 'quote', converted_to: 'o2' }, 'Quote accepted'],
    [base, 'Awaiting payment'],
    [{ ...base, paid_sdg: 1 }, 'Part paid'],
    [{ ...base, paid_sdg: 1000 }, 'Ready to release'],
    [{ ...base, paid_sdg: 1000, released_at: '2026-09-22T10:00:00Z' }, 'Released'],
  ] as const)('%o is "%s"', (order, label) => {
    expect(orderStage(order).label).toBe(label);
  });
});
