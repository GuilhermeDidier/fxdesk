'use client';
import { Printer } from 'lucide-react';

/** Browser print; the page's print styles turn it into a branded one-page PDF. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="btn-quiet w-full">
      <Printer className="size-4" aria-hidden />
      {label}
    </button>
  );
}
