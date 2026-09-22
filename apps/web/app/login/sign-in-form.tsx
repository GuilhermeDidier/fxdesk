'use client';
import { useActionState } from 'react';
import { signIn } from './actions';

export function SignInForm() {
  const [error, action, pending] = useActionState(signIn, null);
  return (
    <form action={action} className="sheet space-y-3 p-4">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Email</span>
        <input name="email" type="email" required autoComplete="email" className="field" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Password</span>
        <input name="password" type="password" required autoComplete="current-password" className="field" />
      </label>
      {error && <p className="text-sm text-red">{error}</p>}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
