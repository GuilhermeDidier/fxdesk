import { formatSdg, formatUsd } from '@fxdesk/money';
import { ArrowLeft, MessageCircle, Plus } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { summarizeCustomers, summaryFor, type CustomerOrder } from '../../../../lib/customers';
import { can, requireAccess } from '../../../../lib/session';
import { supabaseServer } from '../../../../lib/supabase/server';
import type { Customer, OrderStatus } from '../../../../lib/types';
import { StatusBadge } from '../../orders/status';
import { saveLabels } from '../actions';

type OrderRow = CustomerOrder & { id: string; number: number; released_at: string | null; status: OrderStatus };

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  const s = await requireAccess(`/customers/${id}`);
  const supabase = await supabaseServer();
  const [{ data: c }, { data: orders }, { data: transfers }] = await Promise.all([
    supabase.from('customers').select('id, name, city, phone, labels').eq('id', id).maybeSingle<Customer>(),
    supabase
      .from('orders')
      .select('id, number, customer_id, status, booked_on, total_usd_cents, total_sdg, paid_sdg, released_at, converted_to')
      .eq('customer_id', id)
      .order('number', { ascending: false })
      .returns<OrderRow[]>(),
    // Payments are visible to owner and sales only (RLS); marketing gets an empty list.
    supabase.from('payments').select('id, bank_tx_code, received_on, amount_sdg').eq('customer_id', id).order('received_on', { ascending: false }).limit(8),
  ]);
  if (!c) notFound();

  const sum = summaryFor(summarizeCustomers(orders ?? []), id);
  const phone = (c.phone ?? '').replace(/\D/g, '');

  return (
    <>
      <Link href="/customers" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Customers
      </Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">{c.name}</h1>
          <p className="mt-1 text-muted">
            {[c.city, c.phone].filter(Boolean).join(', ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {phone.length >= 8 && (
            <a href={`https://wa.me/${phone}`} target="_blank" rel="noreferrer" className="btn-quiet">
              <MessageCircle className="size-4" aria-hidden />
              WhatsApp
            </a>
          )}
          {can(s, 'owner', 'sales') && (
            <Link href="/orders/new" className="btn-primary">
              <Plus className="size-4" aria-hidden />
              New order
            </Link>
          )}
        </div>
      </header>

      {error && <p role="alert" className="mt-4 rounded-md border border-red/40 bg-red-wash p-3 text-sm text-red">{error}</p>}

      <dl className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="sheet p-4">
          <dt className="eyebrow">Bought</dt>
          <dd className="num mt-1 text-xl font-semibold">{formatUsd(sum.boughtUsdCents)}</dd>
          <dd className="text-xs text-muted">in {sum.orders} order{sum.orders === 1 ? '' : 's'}</dd>
        </div>
        <div className="sheet p-4">
          <dt className="eyebrow">Still to pay</dt>
          <dd className={`num mt-1 text-xl font-semibold ${sum.openSdg ? 'text-red' : ''}`}>{formatSdg(sum.openSdg)}</dd>
        </div>
        <div className="sheet p-4">
          <dt className="eyebrow">Open quotes</dt>
          <dd className="num mt-1 text-xl font-semibold">{sum.openQuotes}</dd>
        </div>
      </dl>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_300px]">
        <section className="sheet overflow-x-auto">
          <p className="eyebrow border-b border-rule px-4 py-3">History</p>
          <table className="w-full min-w-[520px] text-sm">
            <tbody className="divide-y divide-rule">
              {(orders ?? []).map((o) => (
                <tr key={o.id} className="group relative hover:bg-paper/60">
                  <td className="num px-4 py-2.5">
                    <Link href={`/orders/${o.id}`} className="font-semibold text-brand after:absolute after:inset-0 group-hover:underline">
                      {o.status === 'quote' ? 'Q' : ''}
                      {o.number}
                    </Link>
                  </td>
                  <td className="num whitespace-nowrap px-2 text-muted">{o.booked_on}</td>
                  <td className="px-2">
                    <StatusBadge order={o} />
                  </td>
                  <td className="num px-4 text-end">{formatUsd(o.total_usd_cents)}</td>
                </tr>
              ))}
              {(orders ?? []).length === 0 && (
                <tr>
                  <td className="px-4 py-8 text-center text-muted">No orders or quotes yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <aside className="space-y-4">
          <form action={saveLabels.bind(null, c.id)} className="sheet space-y-3 p-4">
            <label className="block">
              <span className="eyebrow">Labels</span>
              <input name="labels" defaultValue={c.labels.join(', ')} className="field mt-2" placeholder="dealer, vip, slow-payer" />
            </label>
            <p className="text-xs text-muted">Separate with commas. Used to filter the customer list.</p>
            <button className="btn-quiet">Save labels</button>
          </form>

          {transfers && transfers.length > 0 && (
            <section className="sheet">
              <p className="eyebrow border-b border-rule px-4 py-3">Latest transfers</p>
              <ul className="divide-y divide-rule text-sm">
                {transfers.map((t) => (
                  <li key={t.id} className="flex justify-between gap-3 px-4 py-2">
                    <span>
                      <span className="num block text-xs">{t.bank_tx_code}</span>
                      <span className="num text-xs text-muted">{t.received_on}</span>
                    </span>
                    <span className="num">{formatSdg(t.amount_sdg)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
