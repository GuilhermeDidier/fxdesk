import { formatSdg, formatUsd } from '@fxdesk/money';
import { Search, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { summarizeCustomers, summaryFor, type CustomerOrder } from '../../../lib/customers';
import { requireAccess } from '../../../lib/session';
import { supabaseServer } from '../../../lib/supabase/server';
import type { Customer } from '../../../lib/types';
import { NewCustomer } from './new-customer';

export const metadata = { title: 'Customers · FX Desk' };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; label?: string }> }) {
  await requireAccess('/customers');
  const { q = '', label } = await searchParams;
  const supabase = await supabaseServer();
  const [{ data: customers }, { data: orders }] = await Promise.all([
    supabase.from('customers').select('id, name, city, phone, labels').order('name').returns<Customer[]>(),
    supabase.from('orders').select('customer_id, status, booked_on, total_usd_cents, total_sdg, paid_sdg, converted_to').returns<CustomerOrder[]>(),
  ]);

  const summary = summarizeCustomers(orders ?? []);
  const allLabels = [...new Set((customers ?? []).flatMap((c) => c.labels))].sort();
  const needle = q.trim().toLowerCase();
  const shown = (customers ?? []).filter(
    (c) => (!label || c.labels.includes(label)) && (!needle || `${c.name} ${c.city ?? ''} ${c.phone ?? ''}`.toLowerCase().includes(needle)),
  );
  const href = (next: { q?: string; label?: string | null }) => {
    const p = new URLSearchParams();
    const nq = next.q ?? q;
    const nl = next.label === undefined ? label : next.label;
    if (nq) p.set('q', nq);
    if (nl) p.set('label', nl);
    return `/customers${p.size ? `?${p}` : ''}`;
  };

  return (
    <>
      <header className="mb-6">
        <p className="eyebrow">Dealers and installers</p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Customers</h1>
      </header>

      <details className="sheet mb-6 [&[open]>summary]:border-b [&[open]>summary]:border-rule">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-brand md:px-5">
          <UserPlus className="size-4" aria-hidden />
          Add a customer
        </summary>
        <NewCustomer />
      </details>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1" aria-label="Filter by label">
          <Link href={href({ label: null })} aria-current={!label ? 'page' : undefined} className={`rounded-full px-3 py-1 text-sm ${!label ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}>
            All
          </Link>
          {allLabels.map((l) => (
            <Link key={l} href={href({ label: l })} aria-current={l === label ? 'page' : undefined} className={`rounded-full px-3 py-1 font-mono text-xs uppercase tracking-wide ${l === label ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}>
              {l}
            </Link>
          ))}
        </nav>
        <form className="relative w-full sm:w-64" role="search">
          {label && <input type="hidden" name="label" value={label} />}
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input name="q" defaultValue={q} placeholder="Name, city or phone" aria-label="Search customers" className="field ps-9" />
        </form>
      </div>

      <div className="sheet overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-rule">
              <th className="px-4 py-2 text-start font-normal">Customer</th>
              <th className="px-2 py-2 text-start font-normal">Labels</th>
              <th className="px-2 py-2 text-end font-normal">Orders</th>
              <th className="px-2 py-2 text-end font-normal">Bought</th>
              <th className="px-2 py-2 text-end font-normal">Still to pay</th>
              <th className="px-4 py-2 text-end font-normal">Last order</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {shown.map((c) => {
              const s = summaryFor(summary, c.id);
              return (
                <tr key={c.id} className="group relative hover:bg-paper/60">
                  <td className="px-4 py-2.5">
                    <Link href={`/customers/${c.id}`} className="font-medium after:absolute after:inset-0 group-hover:underline">
                      {c.name}
                    </Link>
                    {c.city && <span className="block text-xs text-muted">{c.city}</span>}
                  </td>
                  <td className="px-2">
                    <span className="flex flex-wrap gap-1">
                      {c.labels.map((l) => (
                        <span key={l} className="rounded bg-paper px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-wide text-muted">
                          {l}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="num px-2 text-end">
                    {s.orders || null}
                    {s.openQuotes > 0 && <span className="block text-xs text-stamp">{s.openQuotes} open quote{s.openQuotes > 1 ? 's' : ''}</span>}
                  </td>
                  <td className="num px-2 text-end">{s.boughtUsdCents ? formatUsd(s.boughtUsdCents) : null}</td>
                  <td className={`num px-2 text-end ${s.openSdg ? 'text-red' : ''}`}>{s.openSdg ? formatSdg(s.openSdg) : null}</td>
                  <td className="num whitespace-nowrap px-4 text-end text-muted">{s.lastOrderOn}</td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">
                  No customers match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
