import { formatEur, formatUsd } from '@fxdesk/money';
import Link from 'next/link';
import { fingerprint, groupLines, marginPct, type Ccy, type Figures, type LineRow, type PeriodRow } from '../../../lib/profit';
import { requireAccess } from '../../../lib/session';
import { supabaseServer } from '../../../lib/supabase/server';

export const metadata = { title: 'Profit · FX Desk' };

const TABS = { month: 'Month', week: 'Week', product: 'Product', customer: 'Customer', order: 'Order' } as const;
type Tab = keyof typeof TABS;
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ by?: string; ccy?: string }> }) {
  const s = await requireAccess('/reports');
  const q = await searchParams;
  const tab: Tab = q.by && q.by in TABS ? (q.by as Tab) : 'month';
  const ccy: Ccy = q.ccy === 'eur' ? 'eur' : 'usd';
  const c = ccy === 'usd' ? '_usd_cents' : '_eur_cents';
  const fmt = ccy === 'usd' ? formatUsd : formatEur;
  const supabase = await supabaseServer();
  const currentMonth = s.today.slice(0, 8) + '01';

  let rows: Figures[] = [];
  if (tab === 'month' || tab === 'week') {
    const { data } = await supabase.from('profit_by_period').select('*').eq('grain', tab).order('period_start', { ascending: false });
    rows = ((data ?? []) as (PeriodRow & Record<string, number>)[]).map((r) => {
      const closed = tab === 'month' && r.period_start < currentMonth;
      return {
        key: r.period_start,
        label:
          tab === 'month'
            ? new Date(r.period_start + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
            : `Week of ${r.period_start}`,
        sub: tab === 'month' && !closed ? 'open month' : undefined,
        count: r.orders,
        revenue: r['revenue' + c],
        cost: r['cost' + c],
        fx: r['fx' + c],
        // A digest of the stored integers for a closed month. Run this report
        // again next year: if the fingerprint matches, not one cent moved.
        fingerprint: closed ? fingerprint(r) : undefined,
      };
    });
  } else if (tab === 'order') {
    const { data } = await supabase.from('order_profit').select('*').order('number', { ascending: false }).limit(200);
    rows = (data ?? []).map((r) => ({
      key: r.order_id,
      label: `#${r.number}, ${r.customer_name}`,
      sub: r.cost_provisional ? `${r.booked_on}, provisional cost` : r.booked_on,
      count: 1,
      revenue: r['revenue' + c],
      cost: r['cost' + c],
      fx: r['fx' + c],
    }));
  } else {
    const { data } = await supabase.from('line_profit').select('*');
    rows = groupLines((data ?? []) as LineRow[], tab, ccy);
  }

  const total = rows.reduce(
    (t, r) => ({ revenue: t.revenue + r.revenue, cost: t.cost + r.cost, fx: t.fx + (r.fx ?? 0) }),
    { revenue: 0, cost: 0, fx: 0 },
  );
  const showFx = tab !== 'product' && tab !== 'customer';
  const href = (p: { by?: Tab; ccy?: Ccy }) => `/reports?by=${p.by ?? tab}&ccy=${p.ccy ?? ccy}`;

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Owner</p>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Profit</h1>
        </div>
        <div className="inline-flex rounded-md border border-rule bg-sheet p-0.5" role="group" aria-label="Reporting currency">
          {(['usd', 'eur'] as const).map((k) => (
            <Link
              key={k}
              href={href({ ccy: k })}
              aria-current={k === ccy ? 'true' : undefined}
              className={`rounded px-3 py-1 font-mono text-xs font-semibold ${k === ccy ? 'bg-ink text-white' : 'text-muted'}`}
            >
              {k.toUpperCase()}
            </Link>
          ))}
        </div>
      </header>

      <nav className="mb-4 flex gap-1 overflow-x-auto" aria-label="Group profit by">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <Link
            key={t}
            href={href({ by: t })}
            aria-current={t === tab ? 'page' : undefined}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-sm ${t === tab ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
          >
            By {TABS[t].toLowerCase()}
          </Link>
        ))}
      </nav>

      <div className="sheet overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-rule">
              <th className="px-4 py-2 text-start font-normal">{TABS[tab]}</th>
              <th className="px-2 py-2 text-end font-normal">{tab === 'product' ? 'Units' : 'Orders'}</th>
              <th className="px-2 py-2 text-end font-normal">Sales</th>
              <th className="px-2 py-2 text-end font-normal">Landed cost</th>
              <th className="px-2 py-2 text-end font-normal">Margin</th>
              {showFx && (
                <>
                  <th className="px-2 py-2 text-end font-normal">Currency result</th>
                  <th className="px-2 py-2 text-end font-normal">After currency</th>
                </>
              )}
              {tab === 'month' && <th className="px-4 py-2 text-end font-normal">Fingerprint</th>}
            </tr>
          </thead>
          <tbody className="num divide-y divide-rule">
            {rows.map((r) => {
              const margin = r.revenue - r.cost;
              return (
                <tr key={r.key}>
                  <td className="px-4 py-2 font-sans">
                    {r.label}
                    {r.sub && <span className="num block text-xs text-muted">{r.sub}</span>}
                  </td>
                  <td className="px-2 text-end text-muted">{r.count}</td>
                  <td className="px-2 text-end">{fmt(r.revenue)}</td>
                  <td className="px-2 text-end text-muted">{fmt(r.cost)}</td>
                  <td className="px-2 text-end">
                    {fmt(margin)}
                    <span className="block text-xs text-muted">{marginPct(r)}</span>
                  </td>
                  {showFx && (
                    <>
                      <td className={`px-2 text-end ${(r.fx ?? 0) < 0 ? 'text-red' : ''}`}>{fmt(r.fx ?? 0)}</td>
                      <td className="px-2 text-end font-semibold">{fmt(margin + (r.fx ?? 0))}</td>
                    </>
                  )}
                  {tab === 'month' && (
                    <td className="px-4 text-end">
                      {r.fingerprint && <span className="rounded bg-stamp/10 px-1.5 py-0.5 text-xs text-stamp" title="Digest of this closed month's stored totals">{r.fingerprint}</span>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot className="num">
            <tr className="border-t-2 border-ink/70 font-semibold">
              <td className="px-4 py-2.5 font-sans">Total</td>
              <td />
              <td className="px-2 text-end">{fmt(total.revenue)}</td>
              <td className="px-2 text-end">{fmt(total.cost)}</td>
              <td className="px-2 text-end">{fmt(total.revenue - total.cost)}</td>
              {showFx && (
                <>
                  <td className={`px-2 text-end ${total.fx < 0 ? 'text-red' : ''}`}>{fmt(total.fx)}</td>
                  <td className="px-2 text-end">{fmt(total.revenue - total.cost + total.fx)}</td>
                </>
              )}
              {tab === 'month' && <td />}
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-4 max-w-3xl space-y-2 text-sm text-muted">
        <p>
          Sales and costs count on the day the order was booked, at that day&apos;s rate. The currency result counts on
          the day each transfer arrived: the dollars it was really worth minus what the same pounds stood for on the
          order day. A late payment lands in the month it arrives, so a closed month never changes.
        </p>
        {!showFx && <p>The currency result belongs to an order as a whole, so it is not split by {tab}.</p>}
        {ccy === 'eur' && <p>Euro figures use the EUR/USD rate stored with each order and each transfer, not today&apos;s.</p>}
      </div>
    </>
  );
}
