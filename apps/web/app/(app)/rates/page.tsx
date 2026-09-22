import { formatRate } from '@fxdesk/money';
import { Stamp } from '../../../components/stamp';
import { requireRole } from '../../../lib/session';
import { supabaseServer } from '../../../lib/supabase/server';
import type { FxRate } from '../../../lib/types';
import { RateForm } from './rate-form';

export const metadata = { title: 'Rates · FX Desk' };

export default async function RatesPage() {
  const s = await requireRole('owner');
  const supabase = await supabaseServer();
  const [{ data }, used] = await Promise.all([
    supabase.from('fx_rates').select('id, rate_date, sdg_per_usd_e6, eur_per_usd_e6').order('rate_date', { ascending: false }).limit(120).returns<FxRate[]>(),
    s.todayRate
      ? Promise.all([
          supabase.from('orders').select('id', { count: 'exact', head: true }).eq('fx_rate_id', s.todayRate.id),
          supabase.from('payments').select('id', { count: 'exact', head: true }).eq('fx_rate_id', s.todayRate.id),
        ]).then(([o, p]) => (o.count ?? 0) + (p.count ?? 0) > 0)
      : Promise.resolve(false),
  ]);
  const rates = data ?? [];
  const series = [...rates].reverse();

  return (
    <>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="eyebrow">Owner</p>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Rate of the day</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Every order and transfer copies the rate of its own day. Once a rate is used it cannot change, which is
            what keeps old reports identical.
          </p>
        </div>
        {s.todayRate && used && (
          <Stamp label="Frozen" lines={[s.today, `${formatRate(s.todayRate.sdg_per_usd_e6)} SDG/USD`]} />
        )}
      </header>

      <RateForm
        sdg={s.todayRate ? formatRate(s.todayRate.sdg_per_usd_e6).replace(/,/g, '') : ''}
        eur={s.todayRate ? formatRate(s.todayRate.eur_per_usd_e6) : ''}
        locked={used}
      />

      {series.length > 1 && (
        <section className="sheet mt-6 p-5">
          <p className="eyebrow">Pounds per dollar · last {series.length} days</p>
          <RateChart rates={series} />
        </section>
      )}

      <div className="sheet mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-rule">
              <th className="px-4 py-2 text-start font-normal">Day</th>
              <th className="px-2 py-2 text-end font-normal">SDG per USD</th>
              <th className="px-2 py-2 text-end font-normal">Change</th>
              <th className="px-4 py-2 text-end font-normal">EUR per USD</th>
            </tr>
          </thead>
          <tbody className="num divide-y divide-rule">
            {rates.slice(0, 30).map((r, i) => {
              const prev = rates[i + 1];
              const change = prev ? ((r.sdg_per_usd_e6 - prev.sdg_per_usd_e6) / prev.sdg_per_usd_e6) * 100 : null;
              return (
                <tr key={r.id}>
                  <td className="px-4 py-1.5">{r.rate_date}</td>
                  <td className="px-2 text-end">{formatRate(r.sdg_per_usd_e6)}</td>
                  <td className={`px-2 text-end text-xs ${change !== null && change > 0 ? 'text-red' : 'text-muted'}`}>
                    {change === null ? '' : `${change > 0 ? '+' : ''}${change.toFixed(2)}%`}
                  </td>
                  <td className="px-4 text-end text-muted">{formatRate(r.eur_per_usd_e6)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function RateChart({ rates }: { rates: FxRate[] }) {
  const w = 720;
  const h = 160;
  const pad = { l: 44, r: 8, t: 10, b: 20 };
  const values = rates.map((r) => r.sdg_per_usd_e6 / 1e6);
  const min = Math.floor(Math.min(...values) / 250) * 250;
  const max = Math.ceil(Math.max(...values) / 250) * 250;
  const x = (i: number) => pad.l + (i / (rates.length - 1)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min || 1)) * (h - pad.t - pad.b);
  const path = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const ticks = [min, (min + max) / 2, max];
  const first = rates[0];
  const last = rates[rates.length - 1];
  const fall = (1 - first.sdg_per_usd_e6 / last.sdg_per_usd_e6) * 100;

  return (
    <figure className="mt-3">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label={`Pound rate from ${formatRate(first.sdg_per_usd_e6)} to ${formatRate(last.sdg_per_usd_e6)} SDG per dollar`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--color-rule)" strokeDasharray="2 4" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="fill-muted font-mono text-[10px]">
              {t.toLocaleString('en-US')}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="var(--color-ink)" strokeWidth="1.75" strokeLinejoin="round" />
        <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="3.5" fill="var(--color-stamp)" />
        <text x={pad.l} y={h - 4} className="fill-muted font-mono text-[10px]">{first.rate_date}</text>
        <text x={w - pad.r} y={h - 4} textAnchor="end" className="fill-muted font-mono text-[10px]">{last.rate_date}</text>
      </svg>
      <figcaption className="mt-2 text-sm text-muted">
        The pound lost <strong className="text-ink">{fall.toFixed(1)}%</strong> of its dollar value over this period.
      </figcaption>
    </figure>
  );
}
