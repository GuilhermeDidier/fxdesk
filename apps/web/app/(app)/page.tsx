import { formatEur, formatSdg, formatUsd } from '@fxdesk/money';
import Link from 'next/link';
import { can, getSession } from '../../lib/session';
import { supabaseServer } from '../../lib/supabase/server';
import type { BankAccountStatus } from '../../lib/types';

export const metadata = { title: 'Overview · FX Desk' };

interface Attention {
  key: string;
  tone: 'red' | 'sand' | 'plain';
  title: string;
  detail: string;
  href: string;
}

export default async function Overview() {
  const s = await getSession();
  const supabase = await supabaseServer();
  const monthStart = s.today.slice(0, 8) + '01';

  const [orders, accounts, stock, cashToday, profit] = await Promise.all([
    supabase.from('orders').select('id, number, status, total_sdg, paid_sdg, released_at').neq('status', 'cancelled'),
    can(s, 'owner', 'sales') ? supabase.from('bank_account_status').select('*') : Promise.resolve({ data: [] }),
    supabase.from('stock_levels').select('sku, name, on_hand, min_stock').eq('below_min', true),
    can(s, 'owner', 'sales')
      ? supabase.from('payments').select('amount_sdg, usd_value_cents').eq('received_on', s.today)
      : Promise.resolve({ data: [] }),
    can(s, 'owner')
      ? supabase.from('profit_by_period').select('*').eq('grain', 'month').eq('period_start', monthStart).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const all = orders.data ?? [];
  const pending = all.filter((o) => o.status === 'pending_approval');
  const open = all.filter((o) => o.status === 'confirmed' && o.paid_sdg < o.total_sdg);
  const ready = all.filter((o) => o.status === 'confirmed' && o.paid_sdg >= o.total_sdg && !o.released_at);
  const openSdg = open.reduce((sum, o) => sum + o.total_sdg - o.paid_sdg, 0);
  const nearLimit = ((accounts.data ?? []) as BankAccountStatus[]).filter((a) => a.received_today_sdg >= a.daily_limit_sdg * 0.8);
  const low = stock.data ?? [];
  const cash = (cashToday.data ?? []) as { amount_sdg: number; usd_value_cents: number }[];

  const attention: Attention[] = [];
  if (pending.length && can(s, 'owner', 'sales'))
    attention.push({
      key: 'approval',
      tone: 'red',
      title: `${pending.length} order${pending.length > 1 ? 's' : ''} waiting for discount approval`,
      detail: can(s, 'owner') ? 'Customers cannot pay until you approve.' : 'The owner has to approve these first.',
      href: '/orders?view=approval',
    });
  if (ready.length && can(s, 'owner', 'warehouse'))
    attention.push({
      key: 'release',
      tone: 'sand',
      title: `${ready.length} paid order${ready.length > 1 ? 's' : ''} ready to release`,
      detail: 'Fully paid. The goods can leave the warehouse.',
      href: '/orders?view=release',
    });
  for (const a of nearLimit)
    attention.push({
      key: a.bank_account_id,
      tone: a.remaining_today_sdg <= 0 ? 'red' : 'sand',
      title: `${a.name}: ${a.remaining_today_sdg <= 0 ? 'daily limit reached' : `${formatSdg(a.remaining_today_sdg)} left today`}`,
      detail: 'Point dealers to another account for the rest of today.',
      href: '/payments',
    });
  for (const p of low)
    attention.push({
      key: p.sku,
      tone: p.on_hand <= 0 ? 'red' : 'sand',
      title: `${p.name}: ${p.on_hand} in stock`,
      detail: `Minimum is ${p.min_stock}.`,
      href: '/stock',
    });

  const toneBar = { red: 'bg-red', sand: 'bg-sand-ink', plain: 'bg-rule' } as const;

  return (
    <>
      <header className="mb-8">
        <p className="eyebrow">{s.today}</p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Good day, {s.displayName.split(' ')[0]}</h1>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
        <section aria-labelledby="attention">
          <h2 id="attention" className="eyebrow mb-3">
            Needs attention
          </h2>
          {attention.length === 0 ? (
            <p className="sheet p-5 text-sm text-muted">Nothing is waiting on you.</p>
          ) : (
            <ul className="sheet divide-y divide-rule overflow-hidden">
              {attention.map((a) => (
                <li key={a.key}>
                  <Link href={a.href} className="flex gap-4 p-4 transition hover:bg-paper/60">
                    <span className={`w-1 shrink-0 rounded-full ${toneBar[a.tone]}`} aria-hidden />
                    <span>
                      <span className="block font-medium">{a.title}</span>
                      <span className="block text-sm text-muted">{a.detail}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="space-y-4">
          {can(s, 'owner', 'sales') && (
            <section className="sheet p-5">
              <p className="eyebrow">Cash in today</p>
              <p className="num mt-1 text-2xl font-semibold">{formatSdg(cash.reduce((a, p) => a + p.amount_sdg, 0))}</p>
              <p className="num text-xs text-muted">
                {cash.length} transfer{cash.length === 1 ? '' : 's'} · worth {formatUsd(cash.reduce((a, p) => a + p.usd_value_cents, 0))} at today&apos;s rate
              </p>
              <div className="mt-4 border-t border-rule pt-3">
                <p className="eyebrow">Still to collect</p>
                <p className="num mt-1 text-lg font-semibold">{formatSdg(openSdg)}</p>
                <p className="text-xs text-muted">across {open.length} confirmed orders</p>
              </div>
            </section>
          )}
          {profit.data && (
            <section className="sheet p-5">
              <p className="eyebrow">Profit this month · after currency</p>
              <p className="num mt-1 text-2xl font-semibold">{formatUsd(profit.data.net_usd_cents)}</p>
              <p className="num text-sm text-muted">{formatEur(profit.data.net_eur_cents)}</p>
              <p className={`num mt-2 text-xs ${profit.data.fx_usd_cents < 0 ? 'text-red' : 'text-muted'}`}>
                Currency result {formatUsd(profit.data.fx_usd_cents)}
              </p>
              <Link href="/reports" className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">
                Open profit report
              </Link>
            </section>
          )}
          {s.role === 'warehouse' && (
            <section className="sheet p-5">
              <p className="eyebrow">Release rule</p>
              <p className="mt-1 text-sm text-muted">
                Goods leave only for orders paid in full. The database refuses anything else, even if this screen is
                bypassed.
              </p>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
