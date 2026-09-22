import { buildAttention, type AttentionInput } from './attention';

const input: Omit<AttentionInput, 'role'> = {
  orders: [
    { status: 'pending_approval', total_sdg: 100, paid_sdg: 0, released_at: null },
    { status: 'confirmed', total_sdg: 100, paid_sdg: 100, released_at: null },
    { status: 'confirmed', total_sdg: 100, paid_sdg: 100, released_at: '2026-09-01' },
    { status: 'quote', total_sdg: 100, paid_sdg: 0, released_at: null },
    { status: 'quote', total_sdg: 100, paid_sdg: 0, released_at: null, converted_to: 'x' },
  ],
  accounts: [
    { bank_account_id: 'a', name: 'Full', daily_limit_sdg: 15_000_000, received_today_sdg: 15_000_000, remaining_today_sdg: 0 },
    { bank_account_id: 'b', name: 'Near', daily_limit_sdg: 15_000_000, received_today_sdg: 12_000_000, remaining_today_sdg: 3_000_000 },
    { bank_account_id: 'c', name: 'Quiet', daily_limit_sdg: 15_000_000, received_today_sdg: 11_999_999, remaining_today_sdg: 3_000_001 },
  ],
  lowStock: [{ sku: 'X', name: 'Pump', on_hand: 0, min_stock: 2 }],
};
const keys = (role: AttentionInput['role']) => buildAttention({ ...input, role }).map((i) => i.key);

describe('buildAttention', () => {
  it('shows each role only what it can act on', () => {
    expect(keys('owner').sort()).toEqual(['account-a', 'account-b', 'approval', 'quotes', 'release', 'stock-X'].sort());
    expect(keys('sales')).not.toContain('release');
    expect(keys('warehouse').sort()).toEqual(['release', 'stock-X']);
    expect(keys('marketing')).toEqual(['quotes']);
  });

  it('flags accounts from 80% of the daily limit', () => {
    expect(keys('owner')).not.toContain('account-c');
  });

  it('ignores quotes that already became orders', () => {
    expect(buildAttention({ ...input, role: 'marketing' })[0].title).toMatch(/^1 quote /);
  });

  it('puts the urgent items first', () => {
    const tones = buildAttention({ ...input, role: 'owner' }).map((i) => i.tone);
    expect(tones.indexOf('sand')).toBeGreaterThan(tones.lastIndexOf('red'));
  });
});
