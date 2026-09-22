import { whatsappLink } from './whatsapp';

const order = { number: 47, status: 'confirmed', booked_on: '2026-09-22', total_usd_cents: 850_693, total_sdg: 68_161_777, paid_sdg: 8_161_777, sdg_per_usd_e6: 8_012_500_000 };

describe('whatsappLink', () => {
  it('addresses the number in international form and states what is still owed', () => {
    const url = whatsappLink('+249 91 200 1101', 'Nile Solar Supply', order, 3_000_000) ?? '';
    expect(url.startsWith('https://wa.me/249912001101?text=')).toBe(true);
    const text = decodeURIComponent(url.split('text=')[1]);
    expect(text).toContain('order #47');
    expect(text).toContain('68,161,777 SDG ($8,506.93 at 8,012.5 SDG per dollar');
    expect(text).toContain('Still to pay: 60,000,000 SDG');
    expect(text).toContain('at most 3,000,000 SDG');
  });

  it('tells a dealer that a quote is re-priced on the day they confirm', () => {
    const text = decodeURIComponent((whatsappLink('+249912001101', 'X', { ...order, status: 'quote' }, 3_000_000) ?? '').split('text=')[1]);
    expect(text).toContain('quote #47');
    expect(text).not.toContain('Still to pay');
  });

  it('returns nothing without a usable number', () => {
    expect(whatsappLink(null, 'X', order, 1)).toBeNull();
    expect(whatsappLink('12', 'X', order, 1)).toBeNull();
  });
});
