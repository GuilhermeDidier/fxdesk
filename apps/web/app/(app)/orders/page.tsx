import { formatSdg, formatUsd } from '@fxdesk/money';
import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { can, requireAccess } from '../../../lib/session';
import { supabaseServer } from '../../../lib/supabase/server';
import type { Order } from '../../../lib/types';
import { StatusBadge } from './status';

export const metadata = { title: 'Orders · FX Desk' };

const VIEWS = {
  all: 'All',
  open: 'Awaiting payment',
  approval: 'Needs approval',
  release: 'Ready to release',
  quotes: 'Quotes',
} as const;
type View = keyof typeof VIEWS;

type Row = Order & { customer: { name: string; city: string | null } };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string }> }) {
  const s = await requireAccess('/orders');
  const params = await searchParams;
  const view: View = params.view && params.view in VIEWS ? (params.view as View) : s.role === 'warehouse' ? 'release' : 'all';
  const q = (params.q ?? '').trim();
  const supabase = await supabaseServer();

  let query = supabase
    .from('orders')
    .select('id, number, status, booked_on, total_usd_cents, total_sdg, paid_sdg, released_at, converted_to, customer:customers!inner(name, city)')
    .order('number', { ascending: false })
    .limit(300);
  if (view === 'approval') query = query.eq('status', 'pending_approval');
  if (view === 'open') query = query.eq('status', 'confirmed');
  if (view === 'release') query = query.eq('status', 'confirmed').is('released_at', null);
  if (view === 'quotes') query = query.eq('status', 'quote').is('converted_to', null);
  if (/^\d+$/.test(q)) query = query.eq('number', Number(q));
  else if (q) query = query.ilike('customer.name', `%${q.replace(/[%_]/g, '')}%`);

  const { data } = await query.returns<Row[]>();
  let orders = data ?? [];
  if (view === 'open') orders = orders.filter((o) => o.paid_sdg < o.total_sdg);
  if (view === 'release') orders = orders.filter((o) => o.paid_sdg >= o.total_sdg);
  const views = (Object.keys(VIEWS) as View[]).filter((v) => s.role !== 'warehouse' || v === 'all' || v === 'release');

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{s.tenant.brand_name}</p>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Orders</h1>
        </div>
        {can(s, 'owner', 'sales') && (
          <Link href="/orders/new" className="btn-primary">
            <Plus className="size-4" aria-hidden />
            New order
          </Link>
        )}
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1 overflow-x-auto" aria-label="Filter orders">
          {views.map((v) => (
            <Link
              key={v}
              href={`/orders?view=${v}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
              aria-current={v === view ? 'page' : undefined}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-sm ${v === view ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
            >
              {VIEWS[v]}
            </Link>
          ))}
        </nav>
        <form className="relative w-full sm:w-64" role="search">
          <input type="hidden" name="view" value={view} />
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input name="q" defaultValue={q} placeholder="Customer or order number" aria-label="Search orders" className="field ps-9" />
        </form>
      </div>

      <div className="sheet overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-rule">
              <th className="px-4 py-2 text-start font-normal">Number</th>
              <th className="px-2 py-2 text-start font-normal">Booked</th>
              <th className="px-2 py-2 text-start font-normal">Customer</th>
              <th className="px-2 py-2 text-start font-normal">Status</th>
              <th className="px-2 py-2 text-end font-normal">Dollars</th>
              <th className="px-4 py-2 text-end font-normal">Pounds</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {orders.map((o) => (
              <tr key={o.id} className="group relative hover:bg-paper/60">
                <td className="num px-4 py-2.5">
                  <Link href={`/orders/${o.id}`} className="font-semibold text-brand after:absolute after:inset-0 group-hover:underline">
                    {o.status === 'quote' ? 'Q' : ''}
                    {o.number}
                  </Link>
                </td>
                <td className="num px-2 text-muted">{o.booked_on}</td>
                <td className="px-2">
                  {o.customer.name}
                  {o.customer.city && <span className="text-muted">, {o.customer.city}</span>}
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
                  {q ? `No orders match "${q}".` : 'No orders in this view.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
