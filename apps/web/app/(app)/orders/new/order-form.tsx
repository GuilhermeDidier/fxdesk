'use client';
import {
  formatBps,
  formatEur,
  formatRate,
  formatSdg,
  formatUsd,
  parsePercentToBps,
  priceOrder,
  type DiscountPolicy,
} from '@fxdesk/money';
import { useMemo, useState, useTransition } from 'react';
import { BandChip } from '../../../../components/band';
import type { Customer, FxRate, Product } from '../../../../lib/types';
import { createOrder } from '../actions';

interface Row {
  key: number;
  productId: string;
  qty: string;
  discount: string;
}

interface Props {
  customers: Customer[];
  products: Product[];
  onHand: Record<string, number>;
  policy: DiscountPolicy;
  maxTransferSdg: number;
  rate: FxRate | null;
  today: string;
}

let nextKey = 1;
const emptyRow = (): Row => ({ key: nextKey++, productId: '', qty: '1', discount: '0' });

function parseRow(row: Row, products: Map<string, Product>) {
  const product = products.get(row.productId);
  const qty = /^\d+$/.test(row.qty.trim()) ? Number(row.qty) : NaN;
  let discountBps = NaN;
  try {
    discountBps = parsePercentToBps(row.discount || '0');
  } catch {
    /* shown as invalid */
  }
  const valid = Boolean(product) && qty > 0 && Number.isFinite(discountBps) && discountBps <= 10000;
  return { product, qty, discountBps, valid };
}

export function OrderForm({ customers, products, onHand, policy, maxTransferSdg, rate, today }: Props) {
  const [customerId, setCustomerId] = useState('');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const parsed = rows.map((r) => parseRow(r, byId));
  const validLines = parsed.filter((p) => p.valid);

  const priced = rate
    ? priceOrder(
        validLines.map((p) => ({ qty: p.qty, unitPriceUsdCents: p.product!.price_usd_cents, discountBps: p.discountBps })),
        { sdgPerUsdE6: rate.sdg_per_usd_e6, eurPerUsdE6: rate.eur_per_usd_e6 },
        policy,
      )
    : null;
  // map priced lines back onto rows (only valid rows were priced)
  let cursor = 0;
  const rowPricing = parsed.map((p) => (p.valid && priced ? priced.lines[cursor++] : null));

  const gross = priced?.lines.reduce((s, l) => s + l.grossUsdCents, 0) ?? 0;
  const discounts = priced?.lines.reduce((s, l) => s + l.discountUsdCents, 0) ?? 0;
  const transfers = priced && priced.totalSdg > 0 ? Math.ceil(priced.totalSdg / maxTransferSdg) : 0;
  const hasInvalid = rows.some((r, i) => r.productId && !parsed[i].valid);
  const canSubmit = Boolean(rate && customerId && validLines.length > 0 && !hasInvalid && !pending);

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createOrder({
        customerId,
        note,
        lines: parsed.filter((p) => p.valid).map((p) => ({ productId: p.product!.id, qty: p.qty, discountBps: p.discountBps })),
      });
      if (result?.error) setError(result.error);
    });
  }

  const customer = customers.find((c) => c.id === customerId);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        {/* Customer */}
        <section className="sheet p-4 md:p-5">
          <label className="block">
            <span className="eyebrow">Customer</span>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="field mt-2">
              <option value="">Choose a dealer or installer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.city ? ` · ${c.city}` : ''}
                </option>
              ))}
            </select>
          </label>
          {customer && customer.labels.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {customer.labels.map((l) => (
                <span key={l} className="rounded bg-paper px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-wide text-muted">
                  {l}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Lines */}
        <section className="sheet">
          <div className="flex items-baseline justify-between border-b border-rule px-4 py-3 md:px-5">
            <span className="eyebrow">Products · fixed dollar prices</span>
            <span className="text-xs text-muted">
              Sand up to {formatBps(policy.sandMaxBps)} · red up to {formatBps(policy.redMaxBps)} · above needs the owner
            </span>
          </div>

          <div className="hidden grid-cols-[1fr_72px_84px_96px_110px_28px] gap-3 px-5 pt-3 text-xs text-muted md:grid">
            <span>Product</span>
            <span className="text-end">Qty</span>
            <span className="text-end">Discount %</span>
            <span>Band</span>
            <span className="text-end">Line total</span>
            <span />
          </div>

          <ol className="divide-y divide-rule">
            {rows.map((row, i) => {
              const p = parsed[i];
              const priceLine = rowPricing[i];
              const stock = p.product ? onHand[p.product.id] ?? 0 : null;
              const discountInvalid = row.discount !== '' && !Number.isFinite(p.discountBps);
              return (
                <li key={row.key} className="grid grid-cols-2 gap-3 px-4 py-3 md:grid-cols-[1fr_72px_84px_96px_110px_28px] md:items-center md:px-5">
                  <div className="col-span-2 md:col-span-1">
                    <select
                      aria-label={`Product, line ${i + 1}`}
                      value={row.productId}
                      onChange={(e) => update(row.key, { productId: e.target.value })}
                      className="field"
                    >
                      <option value="">Choose a product…</option>
                      {products.map((prod) => (
                        <option key={prod.id} value={prod.id}>
                          {prod.sku} · {prod.name} — {formatUsd(prod.price_usd_cents)}
                        </option>
                      ))}
                    </select>
                    {p.product && (
                      <p className={`mt-1 text-xs ${stock !== null && p.qty > stock ? 'text-red' : 'text-muted'}`}>
                        {formatUsd(p.product.price_usd_cents)} each · {stock} in stock
                        {stock !== null && p.qty > stock ? ' — not enough to release' : ''}
                      </p>
                    )}
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted md:hidden">Qty</span>
                    <input
                      aria-label={`Quantity, line ${i + 1}`}
                      inputMode="numeric"
                      value={row.qty}
                      onChange={(e) => update(row.key, { qty: e.target.value })}
                      className={`field num text-end ${row.qty && !(p.qty > 0) ? 'border-red' : ''}`}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted md:hidden">Discount %</span>
                    <input
                      aria-label={`Discount percent, line ${i + 1}`}
                      inputMode="decimal"
                      value={row.discount}
                      onChange={(e) => update(row.key, { discount: e.target.value })}
                      className={`field num text-end ${discountInvalid ? 'border-red' : ''}`}
                    />
                  </label>
                  <div className="flex items-center">{priceLine && <BandChip band={priceLine.band} />}</div>
                  <div className="num text-end text-sm">
                    {priceLine ? (
                      <>
                        <span className="font-semibold">{formatUsd(priceLine.netUsdCents)}</span>
                        {priceLine.discountUsdCents > 0 && (
                          <span className="block text-xs text-muted">−{formatUsd(priceLine.discountUsdCents)}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setRows((rs) => (rs.length === 1 ? [emptyRow()] : rs.filter((r) => r.key !== row.key)))}
                    className="justify-self-end rounded p-1 text-muted hover:bg-paper hover:text-red"
                    aria-label={`Remove line ${i + 1}`}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="border-t border-rule px-4 py-3 md:px-5">
            <button type="button" onClick={() => setRows((rs) => [...rs, emptyRow()])} className="btn-quiet">
              Add product
            </button>
          </div>
        </section>

        <label className="block">
          <span className="eyebrow">Note for the warehouse (optional)</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="field mt-2" />
        </label>
      </div>

      {/* The slip */}
      <aside className="sheet overflow-hidden lg:sticky lg:top-6" aria-live="polite">
        <div className="space-y-2 p-5">
          <p className="eyebrow">Order total</p>
          <SlipRow label="List price" value={formatUsd(gross)} />
          <SlipRow label="Discounts" value={discounts ? `−${formatUsd(discounts)}` : formatUsd(0)} />
          <SlipRow label="Total in dollars" value={formatUsd(priced?.totalUsdCents ?? 0)} strong />
        </div>

        <div className="border-y border-dashed border-rule bg-paper/60 p-5">
          {rate ? (
            <>
              <p className="num text-xs text-muted">
                × {formatRate(rate.sdg_per_usd_e6)} SDG per dollar, rate of {today}
              </p>
              <p className="mt-1 text-xs font-medium text-muted">Customer pays</p>
              <p className="num text-[28px] font-semibold leading-tight tracking-tight">{formatSdg(priced?.totalSdg ?? 0)}</p>
              {transfers > 0 && (
                <p className="mt-1 text-xs text-muted">
                  At least {transfers} transfer{transfers > 1 ? 's' : ''} of up to {formatSdg(maxTransferSdg)}
                </p>
              )}
              <p className="num mt-3 text-xs text-muted">
                Reported as {formatEur(priced?.totalEurCents ?? 0)} at {formatRate(rate.eur_per_usd_e6)} EUR/USD
              </p>
            </>
          ) : (
            <p className="text-sm text-red">There is no rate for today yet, so the order cannot be priced in pounds.</p>
          )}
        </div>

        <div className="space-y-3 p-5">
          {priced?.needsOwnerApproval && (
            <p className="rounded-md bg-red-wash p-3 text-sm text-red">
              A discount is above {formatBps(policy.redMaxBps)}. The order will be saved but waits for the owner&apos;s
              approval before the customer can pay.
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-md border border-red/40 p-3 text-sm text-red">
              {error}
            </p>
          )}
          <button type="button" onClick={submit} disabled={!canSubmit} className="btn-primary w-full">
            {pending ? 'Booking…' : priced?.needsOwnerApproval ? 'Send for approval' : 'Book order'}
          </button>
          <p className="text-xs text-muted">
            The database re-prices every line from the catalogue and freezes today&apos;s rate on the order. The
            amounts above are a preview of exactly that calculation.
          </p>
        </div>
      </aside>
    </div>
  );
}

function SlipRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${strong ? 'border-t border-rule pt-2' : ''}`}>
      <span className={`text-sm ${strong ? 'font-semibold' : 'text-muted'}`}>{label}</span>
      <span className={`num ${strong ? 'text-lg font-semibold' : 'text-sm'}`}>{value}</span>
    </div>
  );
}
