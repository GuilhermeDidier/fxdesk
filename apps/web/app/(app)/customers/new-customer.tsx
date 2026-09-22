'use client';
import { useActionState } from 'react';
import { createCustomer } from './actions';

export function NewCustomer() {
  const [error, action, pending] = useActionState(createCustomer, null);
  return (
    <form action={action} className="grid gap-3 p-4 sm:grid-cols-2 md:p-5">
      <label className="block">
        <span className="eyebrow">Name</span>
        <input name="name" required className="field mt-2" placeholder="Dealer or installer" />
      </label>
      <label className="block">
        <span className="eyebrow">City</span>
        <input name="city" className="field mt-2" />
      </label>
      <label className="block">
        <span className="eyebrow">WhatsApp number</span>
        <input name="phone" type="tel" className="field num mt-2" placeholder="+249 91 000 0000" />
      </label>
      <label className="block">
        <span className="eyebrow">Labels</span>
        <input name="labels" className="field mt-2" placeholder="dealer, pumps" />
      </label>
      {error && <p role="alert" className="text-sm text-red sm:col-span-2">{error}</p>}
      <div className="sm:col-span-2">
        <button className="btn-primary" disabled={pending}>
          {pending ? 'Adding…' : 'Add customer'}
        </button>
      </div>
    </form>
  );
}
