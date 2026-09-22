import { requireAccess } from '../../../../lib/session';
import { supabaseServer } from '../../../../lib/supabase/server';
import type { BankAccountStatus, Customer } from '../../../../lib/types';
import { PaymentForm, type OpenOrder } from './payment-form';

export const metadata = { title: 'Record a transfer · FX Desk' };

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<{ customer?: string; order?: string }> }) {
  const s = await requireAccess('/payments/new');
  const { customer, order } = await searchParams;
  const supabase = await supabaseServer();
  const [{ data: accounts }, { data: customers }, { data: orders }] = await Promise.all([
    supabase.from('bank_account_status').select('*').order('name'),
    supabase.from('customers').select('id, name, city, phone, labels').order('name'),
    supabase
      .from('orders')
      .select('id, number, booked_on, customer_id, total_sdg, paid_sdg')
      .eq('status', 'confirmed')
      .order('number'),
  ]);

  return (
    <>
      <header className="mb-6">
        <p className="eyebrow">Payments</p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Record a transfer</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          One receipt, one entry. The transaction code can only be recorded once per account, and the transfer is
          valued at the rate of the day it was received.
        </p>
      </header>
      <PaymentForm
        accounts={(accounts ?? []) as BankAccountStatus[]}
        customers={(customers ?? []) as Customer[]}
        openOrders={((orders ?? []) as OpenOrder[]).filter((o) => o.paid_sdg < o.total_sdg)}
        maxTransferSdg={s.tenant.max_transfer_sdg}
        today={s.today}
        initialCustomer={customer ?? ''}
        focusOrder={order ?? null}
      />
    </>
  );
}
