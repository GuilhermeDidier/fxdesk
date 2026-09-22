import { formatSdg, formatUsd } from '@fxdesk/money';
import Link from 'next/link';
import { can, getSession } from '../../../lib/session';
import { supabaseServer } from '../../../lib/supabase/server';
import type { Order } from '../../../lib/types';
import { StatusBadge } from './status';

export const metadata = { title: 'Orders · FX Desk' };

const VIEWS = {
  all: 'All',
  open: 'Awaiting payment',
  approval: 'Needs approval',
  release: 'Ready to release',
} as const;
type View = keyof typeof VIEWS;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const s = await getSession();
  const requested = (await searchParams).view as View | undefined;
  const view: View = requested && requested in VIEWS ? requested : s.role === 'warehouse' ? 'release' : 'all';
  const supabase = await supabaseServer();

  let q = supabase
    .from('orders')
    .select('id, number, status, booked_on, total_usd_cents, total_sdg, paid_sdg, released_at, customer:customers(name, city)')
    .order('number', { ascending: false })
    .limit(200);
  if (view === 'approval') q = q.eq('status', 'pending_approval');
  if (view === 'open') q = q.eq('status', 'confirmed');
  if (view === 'release') q = q.eq('status', 'confirmed').is('released_at', null);

  const { data } = await q.returns<(Order & { customer: { name: string; city: string | null } })[]>();
  let orders = data ?? [];
  if (view === 'open') orders = orders.filter((o) => o.paid_sdg < o.total_sdg);
  if (view === 'release') orders = orders.filter((o) => o.paid_sdg >= o.total_sdg);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{s.tenant.brand_name}</p>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Orders</h1>
        </div>
        {can(s, 'owner', 'sales') && (
          <Link href="/orders/new" className="btn-primary">
            New order
          </Link>
        )}
      </header>

      <nav className="mb-4 flex gap-1 overflow-x-auto" aria-label="Filter orders">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <Link
            key={v}
            href={`/orders?view=${v}`}
            aria-current={v === view ? 'page' : undefined}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-sm ${v === view ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
          >
            {VIEWS[v]}
          </Link>
        ))}
      </nav>

      <div className="sheet overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-rule">
              <th className="px-4 py-2 text-start font-normal">#</th>
              <th className="px-2 py-2 text-start font-normal">Booked</th>
              <th className="px-2 py-2 text-start font-normal">Customer</th>
              <th className="px-2 py-2 text-start font-normal">Status</th>
              <th className="px-2 py-2 text-end font-normal">Dollars</th>
              <th className="px-4 py-2 text-end font-normal">Pounds · open</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {orders.map((o) => (
              <tr key={o.id} className="group hover:bg-paper/60">
                <td className="num px-4 py-2.5">
                  <Link href={`/orders/${o.id}`} className="font-semibold text-brand group-hover:underline">
                    {o.number}
                  </Link>
                </td>
                <td className="num px-2 text-muted">{o.booked_on}</td>
                <td className="px-2">
                  {o.customer.name}
                  <span className="text-muted">{o.customer.city ? ` · ${o.customer.city}` : ''}</span>
                </td>
                <td className="px-2">
                  <StatusBadge order={o} />
                </td>
                <td className="num px-2 text-end">{formatUsd(o.total_usd_cents)}</td>
                <td className="num px-4 text-end">
                  {formatSdg(o.total_sdg)}
                  {o.status === 'confirmed' && o.paid_sdg < o.total_sdg && (
                    <span className="block text-xs text-red">{formatSdg(o.total_sdg - o.paid_sdg)} open</span>
                  )}
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">
                  No orders in this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
