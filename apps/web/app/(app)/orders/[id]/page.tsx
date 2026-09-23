import { discountBand, formatBps, formatEur, formatRate, formatSdg, formatUsd } from '@fxdesk/money';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BandChip } from '../../../../components/band';
import { ConfirmButton } from '../../../../components/confirm-button';
import { PrintButton } from '../../../../components/print-button';
import { Stamp } from '../../../../components/stamp';
import { can, requireAccess } from '../../../../lib/session';
import { supabaseServer } from '../../../../lib/supabase/server';
import type { Order, OrderLine } from '../../../../lib/types';
import { whatsappLink } from '../../../../lib/whatsapp';
import { approveOrder, cancelOrder, convertQuote, releaseOrder } from '../actions';
import { StatusBadge } from '../status';

type OrderRow = Order & {
  customer: { name: string; city: string | null; phone: string | null };
  lines: (OrderLine & { product: { sku: string; name: string } })[];
};

interface Allocation {
  id: number;
  amount_sdg: number;
  fx_result_usd_cents: number;
  payment: { bank_tx_code: string; received_on: string; sdg_per_usd_e6: number; bank_account: { name: string } };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data } = await supabase.from('orders').select('number, status').eq('id', id).maybeSingle();
  return { title: data ? `${data.status === 'quote' ? 'Quote' : 'Order'} #${data.number} · FX Desk` : 'FX Desk' };
}

const longDate = (d: string) =>
  new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ booked?: string; error?: string }>;
}) {
  const [{ id }, { booked, error }] = await Promise.all([params, searchParams]);
  const s = await requireAccess(`/orders/${id}`);
  const supabase = await supabaseServer();

  const { data: order } = await supabase
    .from('orders')
    .select('*, customer:customers(name, city, phone), lines:order_lines(*, product:products(sku, name))')
    .eq('id', id)
    .order('position', { referencedTable: 'order_lines' })
    .maybeSingle<OrderRow>();
  if (!order) notFound();

  const related = [order.converted_to, order.quoted_from].filter(Boolean) as string[];
  const [{ data: allocations }, { data: profit }, { data: links }] = await Promise.all([
    supabase
      .from('payment_allocations')
      .select('id, amount_sdg, fx_result_usd_cents, payment:payments(bank_tx_code, received_on, sdg_per_usd_e6, bank_account:bank_accounts(name))')
      .eq('order_id', id)
      .order('id')
      .returns<Allocation[]>(),
    // Owner only. RLS returns nothing to anyone else, even if this query ran for them.
    can(s, 'owner') ? supabase.from('order_profit').select('*').eq('order_id', id).maybeSingle() : Promise.resolve({ data: null }),
    related.length ? supabase.from('orders').select('id, number').in('id', related) : Promise.resolve({ data: [] }),
  ]);
  const numberOf = (oid: string | null) => links?.find((l) => l.id === oid)?.number;

  const isQuote = order.status === 'quote';
  const policy = { sandMaxBps: s.tenant.sand_max_bps, redMaxBps: s.tenant.red_max_bps };
  const outstanding = order.total_sdg - order.paid_sdg;
  const paidPct = order.total_sdg ? Math.min(100, (order.paid_sdg / order.total_sdg) * 100) : 0;
  const fullyPaid = outstanding === 0 && order.status === 'confirmed';
  const whatsapp = can(s, 'owner', 'sales', 'marketing') && order.status !== 'cancelled' ? whatsappLink(order.customer.phone, s.tenant.brand_name, order, s.tenant.max_transfer_sdg) : null;
  const kind = isQuote ? 'Quote' : 'Order';

  return (
    <>
      <Link href="/orders" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink print:hidden">
        <ArrowLeft className="size-4" aria-hidden />
        Orders
      </Link>

      {/* Letterhead, printed only: the quote leaves the building as this page. */}
      <div className="mb-8 hidden items-end justify-between border-b-2 border-brand pb-4 print:flex">
        <div>
          <p className="font-display text-2xl font-extrabold text-brand">{s.tenant.brand_name}</p>
          <p className="text-sm text-muted">Solar inverters, batteries, panels and pumps</p>
        </div>
        <p className="num text-sm">{longDate(order.booked_on)}</p>
      </div>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-3xl font-extrabold tracking-tight">
              {kind} #{order.number}
            </h1>
            <span className="print:hidden">
              <StatusBadge order={order} />
            </span>
          </div>
          <p className="mt-1 text-muted">
            {order.customer.name}
            {order.customer.city ? `, ${order.customer.city}` : null}
          </p>
          {order.note && <p className="mt-2 max-w-xl text-sm">{order.note}</p>}
          {order.quoted_from && (
            <p className="mt-2 text-sm text-muted print:hidden">
              From <Link href={`/orders/${order.quoted_from}`} className="text-brand underline">quote #{numberOf(order.quoted_from)}</Link>, re-priced at the rate of the day it was accepted.
            </p>
          )}
          {order.converted_to && (
            <p className="mt-2 text-sm text-muted print:hidden">
              Accepted and booked as <Link href={`/orders/${order.converted_to}`} className="text-brand underline">order #{numberOf(order.converted_to)}</Link>.
            </p>
          )}
        </div>
        <Stamp
          animate={booked === '1'}
          label={isQuote ? 'Quoted' : 'Booked'}
          lines={[longDate(order.booked_on), `${formatRate(order.sdg_per_usd_e6)} SDG/USD`, `${formatRate(order.eur_per_usd_e6)} EUR/USD`]}
        />
      </header>

      {error && (
        <p role="alert" className="mt-4 rounded-md border border-red/40 bg-red-wash p-3 text-sm text-red print:hidden">
          {error}
        </p>
      )}

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_320px] print:block">
        <div className="space-y-6">
          <section className="sheet overflow-x-auto print:border-0">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-rule">
                  <th className="px-4 py-2 text-start font-normal">Product</th>
                  <th className="px-2 py-2 text-end font-normal">Qty</th>
                  <th className="px-2 py-2 text-end font-normal">Unit</th>
                  <th className="px-2 py-2 text-end font-normal">Discount</th>
                  <th className="px-4 py-2 text-end font-normal">Line total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {order.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2.5">
                      <span className="num text-xs text-muted">{l.product.sku}</span> {l.product.name}
                    </td>
                    <td className="num px-2 text-end">{l.qty}</td>
                    <td className="num px-2 text-end">{formatUsd(l.unit_price_usd_cents)}</td>
                    <td className="px-2 text-end">
                      {l.discount_bps > 0 && (
                        <span className="inline-flex items-center gap-2">
                          <span className="num">{formatBps(l.discount_bps)}</span>
                          <span className="print:hidden">
                            <BandChip band={discountBand(l.discount_bps, policy)} />
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="num px-4 text-end font-medium">{formatUsd(l.net_usd_cents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-rule">
                  <td colSpan={4} className="px-4 py-2.5 text-end text-muted">
                    Total in dollars
                  </td>
                  <td className="num px-4 text-end font-semibold">{formatUsd(order.total_usd_cents)}</td>
                </tr>
                <tr>
                  <td colSpan={4} className="px-4 pb-2.5 text-end text-muted">
                    In pounds at {formatRate(order.sdg_per_usd_e6)}
                  </td>
                  <td className="num px-4 pb-2.5 text-end font-semibold">{formatSdg(order.total_sdg)}</td>
                </tr>
              </tfoot>
            </table>
          </section>

          {isQuote && (
            <p className="text-sm text-muted">
              Prices are fixed in dollars. The amount in pounds is recalculated at the rate of the day the order is
              confirmed. Pay by bank transfer, at most {formatSdg(s.tenant.max_transfer_sdg)} per transfer.
            </p>
          )}

          {!isQuote && can(s, 'owner', 'sales') && (
            <section className="sheet print:hidden">
              <div className="flex items-baseline justify-between border-b border-rule px-4 py-3">
                <span className="eyebrow">Transfers received</span>
                {order.status === 'confirmed' && outstanding > 0 && (
                  <Link href={`/payments/new?customer=${order.customer_id}&order=${order.id}`} className="text-sm font-semibold text-brand underline-offset-2 hover:underline">
                    Record a transfer
                  </Link>
                )}
              </div>
              {allocations && allocations.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead className="text-xs text-muted">
                      <tr>
                        <th className="px-4 py-2 text-start font-normal">Received</th>
                        <th className="px-2 py-2 text-start font-normal">Transaction</th>
                        <th className="px-2 py-2 text-end font-normal">Pounds</th>
                        <th className="px-2 py-2 text-end font-normal">Rate that day</th>
                        <th className="px-4 py-2 text-end font-normal" title="Dollars actually received minus the dollars those pounds stood for on the order day">
                          Currency result
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-rule">
                      {allocations.map((a) => (
                        <tr key={a.id}>
                          <td className="px-4 py-2">{longDate(a.payment.received_on)}</td>
                          <td className="px-2">
                            <span className="num text-xs">{a.payment.bank_tx_code}</span>
                            <span className="block text-xs text-muted">{a.payment.bank_account.name}</span>
                          </td>
                          <td className="num px-2 text-end">{formatSdg(a.amount_sdg)}</td>
                          <td className="num px-2 text-end">{formatRate(a.payment.sdg_per_usd_e6)}</td>
                          <td className={`num px-4 text-end ${a.fx_result_usd_cents < 0 ? 'text-red' : a.fx_result_usd_cents > 0 ? 'text-paid' : 'text-muted'}`}>
                            {formatUsd(a.fx_result_usd_cents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-4 py-6 text-sm text-muted">
                  {order.status === 'confirmed' ? 'No transfers recorded against this order yet.' : 'Transfers can be recorded once the order is confirmed.'}
                </p>
              )}
            </section>
          )}
        </div>

        <aside className="space-y-4 print:hidden">
          {!isQuote && (
            <section className="sheet p-5">
              <p className="eyebrow">Customer pays</p>
              <p className="num mt-1 text-2xl font-semibold tracking-tight">{formatSdg(order.total_sdg)}</p>
              <p className="num text-xs text-muted">Reported as {formatEur(order.total_eur_cents)}</p>
              {order.status === 'confirmed' && (
                <div className="mt-4" aria-label={`Paid ${Math.floor(paidPct)} percent`}>
                  <div className="h-2 overflow-hidden rounded-full bg-paper">
                    <div className="h-full bg-paid" style={{ width: `${paidPct}%` }} />
                  </div>
                  <div className="mt-2 flex justify-between text-xs">
                    <span className="num">Paid {formatSdg(order.paid_sdg)}</span>
                    <span className={`num ${outstanding ? 'text-red' : 'text-paid'}`}>{outstanding ? `${formatSdg(outstanding)} open` : 'Paid in full'}</span>
                  </div>
                </div>
              )}
            </section>
          )}

          {profit && (
            <section className="sheet p-5">
              <p className="eyebrow">Margin, owner only</p>
              <dl className="mt-2 space-y-1.5 text-sm">
                <Line label="Landed cost" value={formatUsd(profit.cost_usd_cents)} />
                <Line label="Margin before currency" value={formatUsd(profit.margin_usd_cents)} />
                <Line label="Currency result so far" value={formatUsd(profit.fx_usd_cents)} tone={profit.fx_usd_cents < 0 ? 'text-red' : undefined} />
                <Line label="Net margin" value={formatUsd(profit.net_usd_cents)} sub={formatEur(profit.net_eur_cents)} strong />
              </dl>
              {profit.cost_provisional && (
                <p className="mt-3 rounded-md bg-sand/60 p-2.5 text-xs text-sand-ink">
                  Some goods had not landed when this was booked. Their cost is the supplier price without freight and
                  customs, so this margin is optimistic.
                </p>
              )}
            </section>
          )}

          <section className="space-y-2">
            {isQuote && !order.converted_to && can(s, 'owner', 'sales') && (
              <form action={convertQuote.bind(null, order.id)}>
                <button className="btn-primary w-full">Turn into order at today&apos;s rate</button>
              </form>
            )}
            {order.status === 'pending_approval' && can(s, 'owner') && (
              <form action={approveOrder.bind(null, order.id)}>
                <button className="btn-primary w-full">Approve discount</button>
              </form>
            )}
            {order.status === 'pending_approval' && !can(s, 'owner') && (
              <p className="rounded-md bg-red-wash p-3 text-sm text-red">Waiting for the owner to approve a discount above {formatBps(policy.redMaxBps)}.</p>
            )}
            {can(s, 'owner', 'warehouse') && order.status === 'confirmed' && !order.released_at && (
              <form action={releaseOrder.bind(null, order.id)}>
                <button className="btn-primary w-full" disabled={!fullyPaid}>
                  Release goods
                </button>
                {!fullyPaid && <p className="mt-1.5 text-xs text-muted">Goods can leave the warehouse once the order is paid in full.</p>}
              </form>
            )}
            {order.released_at && (
              <p className="text-sm text-paid">Released {new Date(order.released_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</p>
            )}
            {isQuote && <PrintButton label="Print or save as PDF" />}
            {whatsapp && (
              <a href={whatsapp} target="_blank" rel="noreferrer" className="btn-quiet w-full">
                <MessageCircle className="size-4" aria-hidden />
                Send on WhatsApp
              </a>
            )}
            {can(s, 'owner') && order.paid_sdg === 0 && order.status !== 'cancelled' && !order.released_at && !order.converted_to && (
              <form action={cancelOrder.bind(null, order.id)}>
                <ConfirmButton label={`Cancel ${kind.toLowerCase()}`} confirm={`Cancel ${kind.toLowerCase()} #${order.number}?`} className="w-full py-2 text-xs text-muted underline hover:text-red" />
              </form>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

function Line({ label, value, sub, strong, tone }: { label: string; value: string; sub?: string; strong?: boolean; tone?: string }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'border-t border-rule pt-1.5 font-semibold' : ''}`}>
      <dt className={strong ? '' : 'text-muted'}>{label}</dt>
      <dd className={`num text-end ${tone ?? ''}`}>
        {value}
        {sub && <span className="block text-xs font-normal text-muted">{sub}</span>}
      </dd>
    </div>
  );
}
