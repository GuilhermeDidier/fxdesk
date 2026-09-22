import { formatRate } from '@fxdesk/money';
import Link from 'next/link';
import { Nav } from '../../components/nav';
import { can, getSession } from '../../lib/session';
import { signOut } from '../login/actions';

const ROLE_LABEL = { owner: 'Owner', marketing: 'Marketing', sales: 'Sales adviser', warehouse: 'Warehouse' } as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  const items = [
    { href: '/', label: 'Overview' },
    { href: '/orders', label: 'Orders' },
    ...(can(s, 'owner', 'sales') ? [{ href: '/payments', label: 'Payments' }] : []),
    { href: '/stock', label: 'Stock' },
    ...(can(s, 'owner') ? [{ href: '/reports', label: 'Profit' }, { href: '/rates', label: 'Rates' }] : []),
  ];

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[220px_1fr]" style={{ ['--brand' as string]: s.tenant.brand_color }}>
      <aside className="border-b border-rule bg-paper px-4 py-4 md:sticky md:top-0 md:h-dvh md:border-b-0 md:border-e md:px-4 md:py-6">
        <div className="mb-4 flex items-center justify-between md:mb-8 md:block">
          <Link href="/" className="block">
            <span className="block font-display text-lg font-extrabold leading-tight tracking-tight">
              {s.tenant.brand_name}
            </span>
            <span className="eyebrow">Back office</span>
          </Link>
          <form action={signOut} className="md:hidden">
            <button className="text-xs text-muted underline">Sign out</button>
          </form>
        </div>
        <Nav items={items} />
        <div className="mt-8 hidden border-t border-rule pt-4 md:block">
          <p className="text-sm font-medium">{s.displayName}</p>
          <p className="eyebrow mt-0.5">{ROLE_LABEL[s.role]}</p>
          <form action={signOut} className="mt-3">
            <button className="text-xs text-muted underline underline-offset-2 hover:text-ink">Sign out</button>
          </form>
        </div>
      </aside>

      <div className="min-w-0">
        <RateStrip session={s} />
        <main className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

function RateStrip({ session: s }: { session: Awaited<ReturnType<typeof getSession>> }) {
  const date = new Date(s.today + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (!s.todayRate) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-red/30 bg-red-wash px-4 py-2 text-sm text-red md:px-8">
        <strong>No exchange rate for {date}.</strong>
        <span>Orders and payments are paused until {can(s, 'owner') ? 'you set' : 'the owner sets'} today&apos;s rate.</span>
        {can(s, 'owner') && (
          <Link href="/rates" className="font-semibold underline">
            Set today&apos;s rate
          </Link>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-rule bg-sheet px-4 py-2 md:px-8">
      <span className="eyebrow">Rate of the day · {date}</span>
      <span className="num text-sm">
        1 USD = <strong>{formatRate(s.todayRate.sdg_per_usd_e6)}</strong> SDG
      </span>
      <span className="num text-sm text-muted">1 USD = {formatRate(s.todayRate.eur_per_usd_e6)} EUR</span>
    </div>
  );
}
