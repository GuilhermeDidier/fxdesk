import {
  discountBand,
  formatBps,
  formatEur,
  formatRate,
  formatSdg,
  formatUsd,
  fxResultUsdCents,
  parsePercentToBps,
  parseRate,
  parseUsd,
  priceLine,
  priceOrder,
  roundDiv,
  sdgToUsdCents,
  usdCentsToSdg,
} from './money';
import { WORKED_EXAMPLE } from './worked-example';

const policy = { sandMaxBps: 300, redMaxBps: 500 };

describe('roundDiv (half away from zero)', () => {
  it.each([
    [5n, 2n, 3n],
    [-5n, 2n, -3n],
    [4n, 2n, 2n],
    [7n, 3n, 2n],
    [-7n, 3n, -2n],
    [1n, 3n, 0n],
    [3n, 2n, 2n],
  ])('%s / %s = %s', (n, d, expected) => {
    expect(roundDiv(n, d)).toBe(expected);
  });

  it('rejects division by zero', () => {
    expect(() => roundDiv(1n, 0n)).toThrow(RangeError);
  });
});

describe('discountBand', () => {
  it.each([
    [0, 'none'],
    [1, 'sand'],
    [300, 'sand'],
    [301, 'red'],
    [500, 'red'],
    [501, 'blocked'],
  ] as const)('%i bps is %s', (bps, band) => {
    expect(discountBand(bps, policy)).toBe(band);
  });

  it('follows the configured thresholds, not hardcoded ones', () => {
    expect(discountBand(400, { sandMaxBps: 400, redMaxBps: 800 })).toBe('sand');
  });
});

describe('priceLine', () => {
  it('rounds the discount once, half up', () => {
    // 2 x 1,890.50 = 3,781.00 ; 4.5% = 170.145 -> 170.15
    const line = priceLine({ qty: 2, unitPriceUsdCents: 189050, discountBps: 450 }, policy);
    expect(line).toMatchObject({ grossUsdCents: 378100, discountUsdCents: 17015, netUsdCents: 361085, band: 'red' });
  });

  it('rejects non-integers and nonsense', () => {
    expect(() => priceLine({ qty: 1.5, unitPriceUsdCents: 100, discountBps: 0 }, policy)).toThrow();
    expect(() => priceLine({ qty: 0, unitPriceUsdCents: 100, discountBps: 0 }, policy)).toThrow();
    expect(() => priceLine({ qty: 1, unitPriceUsdCents: 10.5, discountBps: 0 }, policy)).toThrow();
    expect(() => priceLine({ qty: 1, unitPriceUsdCents: 100, discountBps: 10001 }, policy)).toThrow();
  });
});

describe('worked example (docs/money.md)', () => {
  const result = priceOrder(WORKED_EXAMPLE.lines, WORKED_EXAMPLE.rates, policy);

  it('reproduces every published number exactly', () => {
    expect(result.lines.map((l) => [l.grossUsdCents, l.discountUsdCents, l.netUsdCents])).toEqual(
      WORKED_EXAMPLE.expected.lines,
    );
    expect(result.totalUsdCents).toBe(WORKED_EXAMPLE.expected.totalUsdCents);
    expect(result.totalSdg).toBe(WORKED_EXAMPLE.expected.totalSdg);
    expect(result.totalEurCents).toBe(WORKED_EXAMPLE.expected.totalEurCents);
    expect(result.needsOwnerApproval).toBe(false);
  });

  it('flags the order for approval when any line goes above the red band', () => {
    const lines = [...WORKED_EXAMPLE.lines, { qty: 1, unitPriceUsdCents: 10000, discountBps: 600 }];
    expect(priceOrder(lines, WORKED_EXAMPLE.rates, policy).needsOwnerApproval).toBe(true);
  });
});

describe('conversions', () => {
  it('handles large orders without float drift (BigInt path)', () => {
    // $2,000,000.00 at 8,012.345678 SDG/USD would exceed 2^53 as an intermediate product
    expect(usdCentsToSdg(200_000_000, 8_012_345_678)).toBe(16_024_691_356);
  });

  it('converts pounds back to dollars at the payment-day rate', () => {
    expect(sdgToUsdCents(3_000_000, 8_000_000_000)).toBe(37_500);
  });

  it('reports a currency loss when the pound falls between order and payment', () => {
    // 3,000,000 SDG: worth $500.00 at 6,000 but only $375.00 at 8,000
    expect(fxResultUsdCents(3_000_000, 6_000_000_000, 8_000_000_000)).toBe(-12_500);
    expect(fxResultUsdCents(3_000_000, 8_000_000_000, 8_000_000_000)).toBe(0);
  });
});

describe('parsing and formatting', () => {
  it('parses rates and amounts without floats', () => {
    expect(parseRate('8012.5')).toBe(8_012_500_000);
    expect(parseRate('0,9184')).toBe(918_400);
    expect(parseUsd('1,249.00')).toBe(124_900);
    expect(parseUsd('1890.5')).toBe(189_050);
    expect(parsePercentToBps('4.5')).toBe(450);
    expect(() => parseUsd('1.999')).toThrow();
    expect(() => parseRate('0')).toThrow();
    expect(() => parseRate('-5')).toThrow();
  });

  it('formats for humans', () => {
    expect(formatUsd(850_693)).toBe('$8,506.93');
    expect(formatEur(-12_500)).toBe('€−125.00');
    expect(formatSdg(68_161_777)).toBe('68,161,777 SDG');
    expect(formatRate(8_012_500_000)).toBe('8,012.5');
    expect(formatRate(8_000_000_000)).toBe('8,000');
    expect(formatBps(450)).toBe('4.5%');
    expect(formatBps(300)).toBe('3%');
  });
});
