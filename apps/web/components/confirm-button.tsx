'use client';
import { useState } from 'react';

/**
 * Two-step button for destructive actions: the first click asks, the second
 * acts. Rendered inside the action's <form>, so the second click submits it.
 */
export function ConfirmButton({ label, confirm, className = '' }: { label: string; confirm: string; className?: string }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className={className}>
        {label}
      </button>
    );
  }
  return (
    <span className="flex items-center justify-center gap-3 rounded-md border border-red/40 bg-red-wash px-3 py-2 text-sm">
      <span className="text-red">{confirm}</span>
      <button type="submit" className="font-semibold text-red underline">
        Yes
      </button>
      <button type="button" onClick={() => setAsking(false)} className="text-muted underline" autoFocus>
        Keep it
      </button>
    </span>
  );
}
