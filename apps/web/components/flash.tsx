'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { toast, Toaster } from 'sonner';

/**
 * Server actions redirect with `?done=<message>`; this shows it once as a
 * toast and removes it from the URL so a refresh does not repeat it.
 */
export function Flash() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const done = params.get('done');
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!done || shown.current === done) return;
    shown.current = done;
    toast.success(done, { id: done });
    const rest = new URLSearchParams(params);
    rest.delete('done');
    router.replace(rest.size ? `${pathname}?${rest}` : pathname, { scroll: false });
  }, [done, params, pathname, router]);

  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: '!rounded-md !border !border-rule !bg-sheet !text-ink !font-sans !shadow-lg',
          description: '!text-muted',
        },
      }}
    />
  );
}
