import { formatRate } from '@fxdesk/money';
import Link from 'next/link';
import { Suspense } from 'react';
import { Flash } from '../../components/flash';
import { Nav } from '../../components/nav';
import { RoleSwitcher } from '../../components/role-switcher';
import { env } from '../../lib/env';
import { MANIFEST, roleDef } from '../../lib/manifest';
import { can, getSession, type Session } from '../../lib/session';
import { signOut } from '../login/actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  const demo = Boolean(env.demoPassword);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[228px_1fr] print:block" style={{ ['--brand' as string]: s.tenant.brand_color }}>
      <aside className="border-b border-rule bg-paper px-4 py-4 print:hidden md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:border-b-0 md:border-e md:py-6">
        <div className="mb-4 flex items-center justify-between md:mb-8 md:block">
          <Link href="/" className="block">
            <span className="block font-display text-lg font-extrabold leading-tight tracking-tight">{s.tenant.brand_name}</span>
            <span className="eyebrow">Order desk</span>
          </Link>
          <form action={signOut} className="md:hidden">
            <button className="text-xs text-muted underline">Sign out</button>
          </form>
        </div>
        <Nav items={MANIFEST[s.role]} />
        <div className="mt-auto hidden space-y-5 border-t border-rule pt-4 md:block">
          <div>
            <p className="text-sm font-medium">{s.displayName}</p>
            <p className="eyebrow mt-0.5">{roleDef(s.role).label}</p>
          </div>
          {demo && <RoleSwitcher active={s.role} />}
          <form action={signOut}>
            <button className="text-xs text-muted underline underline-offset-2 hover:text-ink">Sign out</button>
          </form>
        </div>
      </aside>

      <div className="min-w-0">
        <RateStrip session={s} demo={demo} />
        <main className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
      <Suspense>
        <Flash />
      </Suspense>
    </div>
  );
}

function RateStrip({ session: s, demo }: { session: Session; demo: boolean }) {
  const date = new Date(s.today + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (!s.todayRate) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-red/30 bg-red-wash px-4 py-2 text-sm text-red print:hidden md:px-8">
        <strong>No exchange rate for {date}.</strong>
        <span>Orders and payments wait until {can(s, 'owner') ? 'you set' : 'the owner sets'} today&apos;s rate.</span>
        {can(s, 'owner') && (
          <Link href="/rates" className="font-semibold underline">
            Set today&apos;s rate
          </Link>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-rule bg-sheet px-4 py-2 print:hidden md:px-8">
      <span className="eyebrow">Rate of the day, {date}</span>
      <span className="num text-sm">
        1 USD = <strong>{formatRate(s.todayRate.sdg_per_usd_e6)}</strong> SDG
      </span>
      <span className="num text-sm text-muted">1 USD = {formatRate(s.todayRate.eur_per_usd_e6)} EUR</span>
      {demo && <span className="ms-auto text-xs text-muted">Sample data</span>}
    </div>
  );
}
