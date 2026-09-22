import { formatRate, formatSdg, formatUsd } from '@fxdesk/money';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { LimitBar } from '../../../components/limit-bar';
import { requireAccess } from '../../../lib/session';
import { supabaseServer } from '../../../lib/supabase/server';
import type { BankAccountStatus } from '../../../lib/types';

export const metadata = { title: 'Payments · FX Desk' };

interface PaymentRow {
  id: string;
  bank_tx_code: string;
  amount_sdg: number;
  allocated_sdg: number;
  received_on: string;
  sdg_per_usd_e6: number;
  usd_value_cents: number;
  proof_path: string | null;
  customer: { name: string };
  bank_account: { name: string };
}

export default async function PaymentsPage() {
  await requireAccess('/payments');
  const supabase = await supabaseServer();
  const [{ data: accounts }, { data: payments }] = await Promise.all([
    supabase.from('bank_account_status').select('*').order('name'),
    supabase
      .from('payments')
      .select('id, bank_tx_code, amount_sdg, allocated_sdg, received_on, sdg_per_usd_e6, usd_value_cents, proof_path, customer:customers(name), bank_account:bank_accounts(name)')
      .order('received_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(60)
      .returns<PaymentRow[]>(),
  ]);

  const withProof = (payments ?? []).flatMap((p) => (p.proof_path ? [p.proof_path] : []));
  const { data: signed } = withProof.length
    ? await supabase.storage.from('payment-proofs').createSignedUrls(withProof, 600)
    : { data: [] };
  const proofUrl = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Cash</p>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Payments</h1>
        </div>
        <Link href="/payments/new" className="btn-primary">
          <Plus className="size-4" aria-hidden />
          Record a transfer
        </Link>
      </header>

      <section aria-label="Bank accounts" className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {((accounts ?? []) as BankAccountStatus[]).map((a) => (
          <div key={a.bank_account_id} className="sheet p-4">
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-semibold">{a.name}</p>
              <p className="text-xs text-muted">{a.bank}</p>
            </div>
            <p className="mt-3 text-xs text-muted">Received today</p>
            <LimitBar used={a.received_today_sdg} limit={a.daily_limit_sdg} />
            <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-rule pt-3 text-xs">
              <div>
                <dt className="text-muted">Balance received</dt>
                <dd className="num mt-0.5 text-sm">{formatSdg(a.received_total_sdg)}</dd>
              </div>
              <div>
                <dt className="text-muted">Not yet applied</dt>
                <dd className={`num mt-0.5 text-sm ${a.unallocated_sdg ? 'text-sand-ink' : ''}`}>{formatSdg(a.unallocated_sdg)}</dd>
              </div>
            </dl>
          </div>
        ))}
      </section>

      <div className="sheet overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-rule">
              <th className="px-4 py-2 text-start font-normal">Received</th>
              <th className="px-2 py-2 text-start font-normal">Transaction</th>
              <th className="px-2 py-2 text-start font-normal">Customer</th>
              <th className="px-2 py-2 text-end font-normal">Pounds</th>
              <th className="px-2 py-2 text-end font-normal">Rate that day</th>
              <th className="px-2 py-2 text-end font-normal">Worth in dollars</th>
              <th className="px-4 py-2 text-end font-normal">Proof</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {(payments ?? []).map((p) => (
              <tr key={p.id}>
                <td className="num px-4 py-2 text-muted">{p.received_on}</td>
                <td className="px-2">
                  <span className="num text-xs">{p.bank_tx_code}</span>
                  <span className="block text-xs text-muted">{p.bank_account.name}</span>
                </td>
                <td className="px-2">{p.customer.name}</td>
                <td className="num px-2 text-end">
                  {formatSdg(p.amount_sdg)}
                  {p.allocated_sdg < p.amount_sdg && (
                    <span className="block text-xs text-sand-ink">{formatSdg(p.amount_sdg - p.allocated_sdg)} unapplied</span>
                  )}
                </td>
                <td className="num px-2 text-end text-muted">{formatRate(p.sdg_per_usd_e6)}</td>
                <td className="num px-2 text-end">{formatUsd(p.usd_value_cents)}</td>
                <td className="px-4 text-end">
                  {p.proof_path && proofUrl.get(p.proof_path) && (
                    <a href={proofUrl.get(p.proof_path) ?? undefined} target="_blank" rel="noreferrer" className="text-brand underline">
                      View
                    </a>
                  )}
                </td>
              </tr>
            ))}
            {(payments ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  No transfers recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
