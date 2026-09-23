/**
 * Money rules shared by the UI preview and mirrored exactly by the SQL in
 * supabase/migrations (see docs/money.md). The database is the source of truth;
 * this module exists so the order screen can show the same numbers before saving,
 * and a contract test proves both sides agree.
 *
 * Units (all integers):
 *   USD  -> cents
 *   EUR  -> cents
 *   SDG  -> whole pounds (bank transfers are whole pounds)
 *   rates -> units of the quote currency per 1 USD, scaled by 10^6
 *            e.g. 8,012.5 SDG/USD -> 8_012_500_000 ; 0.9184 EUR/USD -> 918_400
 *
 * Rounding: half away from zero, applied once per step (line discount, then the
 * order-level conversion). Converting the order total, not each line, keeps the
 * pound total equal to "dollar total x rate" as a dealer would check it.
 */

export const RATE_SCALE = 1_000_000n;
export const BPS_SCALE = 10_000n;

export type DiscountBand = 'none' | 'sand' | 'red' | 'blocked';

export interface DiscountPolicy {
  /** Max discount an adviser can give freely (basis points). */
  sandMaxBps: number;
  /** Max discount before owner approval is required (basis points). */
  redMaxBps: number;
}

export interface Rates {
  sdgPerUsdE6: number;
  eurPerUsdE6: number;
}

export interface LineInput {
  qty: number;
  unitPriceUsdCents: number;
  discountBps: number;
}

export interface PricedLine extends LineInput {
  grossUsdCents: number;
  discountUsdCents: number;
  netUsdCents: number;
  band: DiscountBand;
}

export interface PricedOrder {
  lines: PricedLine[];
  totalUsdCents: number;
  totalSdg: number;
  totalEurCents: number;
  needsOwnerApproval: boolean;
}

function assertInt(value: number, name: string): bigint {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer, got ${value}`);
  }
  return BigInt(value);
}

function toSafeNumber(value: bigint, name: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`${name} overflowed the safe integer range`);
  }
  return n;
}

/** Integer division rounded half away from zero (same as Postgres round(numeric)). */
export function roundDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('division by zero');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (2n * d);
  return negative ? -q : q;
}

export function discountBand(discountBps: number, policy: DiscountPolicy): DiscountBand {
  if (discountBps < 0) throw new RangeError('discount cannot be negative');
  if (discountBps === 0) return 'none';
  if (discountBps <= policy.sandMaxBps) return 'sand';
  if (discountBps <= policy.redMaxBps) return 'red';
  return 'blocked';
}

export function priceLine(line: LineInput, policy: DiscountPolicy): PricedLine {
  const qty = assertInt(line.qty, 'qty');
  const price = assertInt(line.unitPriceUsdCents, 'unitPriceUsdCents');
  const bps = assertInt(line.discountBps, 'discountBps');
  if (qty <= 0n) throw new RangeError('qty must be positive');
  if (price < 0n) throw new RangeError('price cannot be negative');
  if (bps > BPS_SCALE) throw new RangeError('discount above 100%');

  const gross = qty * price;
  const discount = roundDiv(gross * bps, BPS_SCALE);
  return {
    ...line,
    grossUsdCents: toSafeNumber(gross, 'gross'),
    discountUsdCents: toSafeNumber(discount, 'discount'),
    netUsdCents: toSafeNumber(gross - discount, 'net'),
    band: discountBand(line.discountBps, policy),
  };
}

export function usdCentsToSdg(usdCents: number, sdgPerUsdE6: number): number {
  const v = roundDiv(assertInt(usdCents, 'usdCents') * assertInt(sdgPerUsdE6, 'rate'), 100n * RATE_SCALE);
  return toSafeNumber(v, 'sdg');
}

export function usdCentsToEurCents(usdCents: number, eurPerUsdE6: number): number {
  const v = roundDiv(assertInt(usdCents, 'usdCents') * assertInt(eurPerUsdE6, 'rate'), RATE_SCALE);
  return toSafeNumber(v, 'eurCents');
}

/** What a pound amount was worth in dollars on the day it was received. */
export function sdgToUsdCents(sdg: number, sdgPerUsdE6: number): number {
  const v = roundDiv(assertInt(sdg, 'sdg') * 100n * RATE_SCALE, assertInt(sdgPerUsdE6, 'rate'));
  return toSafeNumber(v, 'usdCents');
}

export function priceOrder(lines: readonly LineInput[], rates: Rates, policy: DiscountPolicy): PricedOrder {
  const priced = lines.map((l) => priceLine(l, policy));
  const totalUsdCents = priced.reduce((sum, l) => sum + l.netUsdCents, 0);
  return {
    lines: priced,
    totalUsdCents,
    totalSdg: usdCentsToSdg(totalUsdCents, rates.sdgPerUsdE6),
    totalEurCents: usdCentsToEurCents(totalUsdCents, rates.eurPerUsdE6),
    needsOwnerApproval: priced.some((l) => l.band === 'blocked'),
  };
}

/**
 * Currency result of one payment allocation: dollars actually realised on the
 * payment day minus the dollars that pound amount stood for on the order day.
 * Negative when the pound fell between order and payment.
 */
export function fxResultUsdCents(allocatedSdg: number, orderRateE6: number, paymentRateE6: number): number {
  return sdgToUsdCents(allocatedSdg, paymentRateE6) - sdgToUsdCents(allocatedSdg, orderRateE6);
}

/** Parse a decimal string ("8012.5", "0.9184") into a rate scaled by 10^6. */
export function parseRate(input: string): number {
  const match = /^\s*(\d+)(?:[.,](\d{1,6}))?\s*$/.exec(input);
  if (!match) throw new RangeError(`invalid rate: ${input}`);
  const [, whole, frac = ''] = match;
  const v = BigInt(whole) * RATE_SCALE + BigInt(frac.padEnd(6, '0'));
  if (v === 0n) throw new RangeError('rate must be positive');
  return toSafeNumber(v, 'rate');
}

/** Parse "1,249.00" or "1249" into cents. Rejects more than 2 decimals. */
export function parseUsd(input: string): number {
  const match = /^\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (!match) throw new RangeError(`invalid amount: ${input}`);
  const [, whole, frac = ''] = match;
  return toSafeNumber(BigInt(whole.replace(/,/g, '')) * 100n + BigInt(frac.padEnd(2, '0')), 'cents');
}

/** Parse "2", "4.5", "4,5" percent into basis points. */
export function parsePercentToBps(input: string): number {
  const match = /^\s*(\d{1,3})(?:[.,](\d{1,2}))?\s*$/.exec(input);
  if (!match) throw new RangeError(`invalid percent: ${input}`);
  const [, whole, frac = ''] = match;
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function formatMinor(minor: number, decimals: number): string {
  const negative = minor < 0;
  const abs = Math.abs(minor).toString().padStart(decimals + 1, '0');
  const whole = decimals ? abs.slice(0, -decimals) : abs;
  const frac = decimals ? '.' + abs.slice(-decimals) : '';
  return (negative ? '−' : '') + group(whole) + frac;
}

const signed = (symbol: string, cents: number) => (cents < 0 ? '−' : '') + symbol + formatMinor(Math.abs(cents), 2);
export const formatUsd = (cents: number) => signed('$', cents);
export const formatEur = (cents: number) => signed('€', cents);
export const formatSdg = (sdg: number) => formatMinor(sdg, 0) + ' SDG';
export const formatBps = (bps: number) => formatMinor(bps, 2).replace(/\.?0+$/, '') + '%';

export function formatRate(rateE6: number): string {
  const s = formatMinor(rateE6, 6);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}
