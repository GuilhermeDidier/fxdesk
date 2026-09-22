'use client';
import { useActionState } from 'react';
import { setTodayRate } from './actions';

export function RateForm({ sdg, eur, locked }: { sdg: string; eur: string; locked: boolean }) {
  const [error, action, pending] = useActionState(setTodayRate, null);
  return (
    <form action={action} className="sheet grid gap-4 p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <label className="block">
        <span className="eyebrow">SDG per 1 USD</span>
        <input name="sdg" defaultValue={sdg} inputMode="decimal" required disabled={locked} className="field num mt-2 text-end" />
      </label>
      <label className="block">
        <span className="eyebrow">EUR per 1 USD</span>
        <input name="eur" defaultValue={eur} inputMode="decimal" required disabled={locked} className="field num mt-2 text-end" />
      </label>
      <button className="btn-primary" disabled={pending || locked}>
        {pending ? 'Saving…' : sdg ? 'Correct today’s rate' : 'Set today’s rate'}
      </button>
      {locked && (
        <p className="text-sm text-muted sm:col-span-3">
          Today&apos;s rate is already on booked orders or payments, so it is frozen.
        </p>
      )}
      {error && <p role="alert" className="text-sm text-red sm:col-span-3">{error}</p>}
    </form>
  );
}
