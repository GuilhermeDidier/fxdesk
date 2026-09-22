import { ArrowRight } from 'lucide-react';
import { DEMO_USERS } from '../../lib/demo';
import { env } from '../../lib/env';
import { ROLES } from '../../lib/manifest';
import { signInDemo } from './actions';
import { SignInForm } from './sign-in-form';

export const metadata = { title: 'FX Desk · order desk for a solar importer' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const demo = Boolean(env.demoPassword);

  return (
    <main className="mx-auto grid min-h-dvh max-w-5xl content-center gap-10 px-4 py-10 md:grid-cols-[1.1fr_1fr] md:px-8">
      <section className="self-center">
        <p className="eyebrow">Nile Solar Supply, order desk</p>
        <h1 className="mt-3 font-display text-4xl font-extrabold leading-[1.05] tracking-tight md:text-5xl">
          Priced in dollars.
          <br />
          Paid in pounds.
          <br />
          <span className="text-stamp">Reported in euros.</span>
        </h1>
        <p className="mt-5 max-w-md text-muted">
          One desk for 570 dealers and installers, while the pound slides from 6,050 to 8,000 per dollar. Every amount
          is booked with the rate of its own day, so last month&apos;s report never moves.
        </p>
        {error === 'demo' && <p className="mt-4 text-sm text-red">The demo accounts are not set up on this environment.</p>}
        {error === 'no-membership' && <p className="mt-4 text-sm text-red">This account does not belong to a company yet.</p>}
      </section>

      <section className="space-y-3">
        {demo ? (
          <>
            <p className="eyebrow">Open it as</p>
            <ul className="space-y-3">
              {ROLES.map((r) => (
                <li key={r.key}>
                  <form action={signInDemo.bind(null, r.key)}>
                    <button className="sheet group flex w-full items-center gap-4 p-4 text-start transition hover:border-ink/40">
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="font-display text-lg font-bold">{r.label}</span>
                          <span className="num hidden text-[11px] text-muted sm:inline">{DEMO_USERS[r.key]}</span>
                        </span>
                        <span className="mt-1 block text-sm text-muted">{r.pitch}</span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden />
                    </button>
                  </form>
                </li>
              ))}
            </ul>
            <p className="pt-3 text-xs text-muted">
              Concept prototype for a solar equipment importer. Sample data only, not affiliated with any company. Each
              card signs in as a real user of that role; what they can see is enforced by the database.
            </p>
          </>
        ) : (
          <SignInForm />
        )}
      </section>
    </main>
  );
}
