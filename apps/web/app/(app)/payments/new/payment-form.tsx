'use client';
import { formatSdg } from '@fxdesk/money';
import { useActionState, useState } from 'react';
import { LimitBar } from '../../../../components/limit-bar';
import type { BankAccountStatus, Customer } from '../../../../lib/types';
import { recordPayment } from '../actions';

export interface OpenOrder {
  id: string;
  number: number;
  booked_on: string;
  customer_id: string;
  total_sdg: number;
  paid_sdg: number;
}

interface Props {
  accounts: BankAccountStatus[];
  customers: Customer[];
  openOrders: OpenOrder[];
  maxTransferSdg: number;
  today: string;
  initialCustomer: string;
  focusOrder: string | null;
}

const toInt = (v: string) => {
  const n = Number(v.replace(/[,\s]/g, ''));
  return Number.isSafeInteger(n) && n >= 0 ? n : NaN;
};

/** Oldest open order first, until the transfer is used up. */
function autoAllocate(amount: number, orders: OpenOrder[], first: string | null) {
  const sorted = [...orders].sort((a, b) => (a.id === first ? -1 : b.id === first ? 1 : a.number - b.number));
  const out: Record<string, string> = {};
  let left = amount;
  for (const o of sorted) {
    const take = Math.min(left, o.total_sdg - o.paid_sdg);
    out[o.id] = take > 0 ? String(take) : '';
    left -= take;
  }
  return out;
}

export function PaymentForm({ accounts, customers, openOrders, maxTransferSdg, today, initialCustomer, focusOrder }: Props) {
  const [error, action, pending] = useActionState(recordPayment, null);
  const [accountId, setAccountId] = useState(accounts.find((a) => a.remaining_today_sdg > 0)?.bank_account_id ?? '');
  const [customerId, setCustomerId] = useState(initialCustomer);
  const [amount, setAmount] = useState('');
  const [receivedOn, setReceivedOn] = useState(today);
  const [alloc, setAlloc] = useState<Record<string, string>>({});

  const account = accounts.find((a) => a.bank_account_id === accountId);
  const orders = openOrders.filter((o) => o.customer_id === customerId);
  const amountN = toInt(amount);
  const allocated = Object.values(alloc).reduce((s, v) => s + (toInt(v) || 0), 0);
  const overMax = amountN > maxTransferSdg;
  const overLimit = account && receivedOn === today && amountN > account.remaining_today_sdg;
  const overAllocated = amountN >= 0 && allocated > amountN;
  const allocations = Object.entries(alloc)
    .map(([order_id, v]) => ({ order_id, amount_sdg: toInt(v) || 0 }))
    .filter((a) => a.amount_sdg > 0 && orders.some((o) => o.id === a.order_id));

  function changeAmount(v: string) {
    setAmount(v);
    const n = toInt(v);
    if (n > 0) setAlloc(autoAllocate(n, orders, focusOrder));
  }
  function changeCustomer(id: string) {
    setCustomerId(id);
    const n = toInt(amount);
    setAlloc(n > 0 ? autoAllocate(n, openOrders.filter((o) => o.customer_id === id), focusOrder) : {});
  }

  return (
    <form action={action} className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
      <input type="hidden" name="allocations" value={JSON.stringify(allocations)} />
      <input type="hidden" name="return_to" value={focusOrder ? `/orders/${focusOrder}` : ''} />

      <div className="space-y-6">
        <section className="sheet grid gap-4 p-4 md:grid-cols-2 md:p-5">
          <label className="block md:col-span-2">
            <span className="eyebrow">Into account</span>
            <select name="bank_account_id" value={accountId} onChange={(e) => setAccountId(e.target.value)} required className="field mt-2">
              {accounts.map((a) => (
                <option key={a.bank_account_id} value={a.bank_account_id}>
                  {a.name} — {formatSdg(a.remaining_today_sdg)} left today
                </option>
              ))}
            </select>
          </label>
          <label className="block md:col-span-2">
            <span className="eyebrow">From customer</span>
            <select name="customer_id" value={customerId} onChange={(e) => changeCustomer(e.target.value)} required className="field mt-2">
              <option value="">Who sent it?</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.city ? ` · ${c.city}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="eyebrow">Transaction code</span>
            <input name="tx_code" required placeholder="As printed on the receipt" className="field num mt-2 uppercase" autoComplete="off" />
          </label>
          <label className="block">
            <span className="eyebrow">Received on</span>
            <input name="received_on" type="date" max={today} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} className="field num mt-2" />
          </label>
          <label className="block">
            <span className="eyebrow">Amount (SDG)</span>
            <input
              name="amount"
              inputMode="numeric"
              required
              value={amount}
              onChange={(e) => changeAmount(e.target.value)}
              placeholder={`Up to ${formatSdg(maxTransferSdg)}`}
              className={`field num mt-2 text-end ${overMax || overLimit || Number.isNaN(amountN) ? 'border-red' : ''}`}
            />
            {overMax && <span className="mt-1 block text-xs text-red">A single transfer is at most {formatSdg(maxTransferSdg)}.</span>}
            {!overMax && overLimit && <span className="mt-1 block text-xs text-red">This account can only take {formatSdg(account.remaining_today_sdg)} more today.</span>}
          </label>
          <label className="block">
            <span className="eyebrow">Photo of the receipt</span>
            <input name="proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" className="mt-2 block w-full text-sm file:me-3 file:rounded-md file:border file:border-rule file:bg-sheet file:px-3 file:py-2 file:text-sm" />
          </label>
        </section>

        <section className="sheet">
          <div className="border-b border-rule px-4 py-3 md:px-5">
            <span className="eyebrow">Pays which orders</span>
          </div>
          {!customerId ? (
            <p className="px-5 py-6 text-sm text-muted">Choose the customer to see their open orders.</p>
          ) : orders.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">This customer has no open orders. The transfer will be kept as credit to apply later.</p>
          ) : (
            <ul className="divide-y divide-rule">
              {orders.map((o) => {
                const open = o.total_sdg - o.paid_sdg;
                const v = alloc[o.id] ?? '';
                const tooMuch = toInt(v) > open;
                return (
                  <li key={o.id} className="grid grid-cols-[1fr_160px] items-center gap-3 px-4 py-3 md:px-5">
                    <div>
                      <p className="text-sm font-medium">
                        Order #{o.number} <span className="num text-xs text-muted">· {o.booked_on}</span>
                      </p>
                      <p className="num text-xs text-muted">{formatSdg(open)} open of {formatSdg(o.total_sdg)}</p>
                    </div>
                    <input
                      aria-label={`Amount for order ${o.number}`}
                      inputMode="numeric"
                      value={v}
                      onChange={(e) => setAlloc((a) => ({ ...a, [o.id]: e.target.value }))}
                      className={`field num text-end ${tooMuch ? 'border-red' : ''}`}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <aside className="sheet space-y-3 p-5 lg:sticky lg:top-6">
        <p className="eyebrow">This transfer</p>
        <div className="flex justify-between text-sm">
          <span className="text-muted">Amount</span>
          <span className="num">{formatSdg(amountN || 0)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted">Applied to orders</span>
          <span className={`num ${overAllocated ? 'text-red' : ''}`}>{formatSdg(allocated)}</span>
        </div>
        <div className="flex justify-between border-t border-rule pt-2 text-sm font-semibold">
          <span>Kept as credit</span>
          <span className="num">{formatSdg(Math.max(0, (amountN || 0) - allocated))}</span>
        </div>
        {account && (
          <div className="pt-2">
            <p className="text-xs text-muted">{account.name} today</p>
            <LimitBar used={account.received_today_sdg + (receivedOn === today && amountN > 0 ? amountN : 0)} limit={account.daily_limit_sdg} />
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-md border border-red/40 p-3 text-sm text-red">
            {error}
          </p>
        )}
        <button className="btn-primary w-full" disabled={pending || overMax || Boolean(overLimit) || overAllocated || !(amountN > 0)}>
          {pending ? 'Recording…' : 'Record transfer'}
        </button>
      </aside>
    </form>
  );
}
