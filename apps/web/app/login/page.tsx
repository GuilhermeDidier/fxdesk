import { env } from '../../lib/env';
import { DEMO_USERS } from '../../lib/demo';
import { signInDemo } from './actions';
import { SignInForm } from './sign-in-form';

const ROLES = [
  { role: 'sales', title: 'Sales adviser', does: 'Books orders at fixed dollar prices, records transfers. Never sees a cost price.' },
  { role: 'owner', title: 'Owner', does: 'Sets the rate of the day, approves discounts above 5%, sees profit in USD and EUR.' },
  { role: 'warehouse', title: 'Warehouse', does: 'Releases goods, but only for orders that are fully paid.' },
] as const;

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const demo = Boolean(env.demoPassword);

  return (
    <main className="mx-auto grid min-h-dvh max-w-5xl content-center gap-10 px-4 py-10 md:grid-cols-[1.1fr_1fr] md:px-8">
      <section>
        <p className="eyebrow">FX Desk · demo</p>
        <h1 className="mt-3 font-display text-4xl font-extrabold leading-[1.05] tracking-tight md:text-5xl">
          Priced in dollars.
          <br />
          Paid in pounds.
          <br />
          <span className="text-stamp">Reported in euros.</span>
        </h1>
        <p className="mt-5 max-w-md text-muted">
          An order desk for a solar importer whose currency loses a quarter of its value in three months. Every
          amount is an integer, booked with the rate of its own day, so last month&apos;s report never moves.
        </p>
        {error === 'demo' && <p className="mt-4 text-sm text-red">Demo accounts are not set up on this environment.</p>}
        {error === 'no-membership' && <p className="mt-4 text-sm text-red">This account does not belong to a company yet.</p>}
      </section>

      <section className="space-y-3">
        {demo ? (
          <>
            <p className="eyebrow">Sign in as</p>
            {ROLES.map((r) => (
              <form key={r.role} action={signInDemo.bind(null, r.role)}>
                <button className="sheet group w-full p-4 text-start transition hover:border-ink/40">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-display text-lg font-bold">{r.title}</span>
                    <span className="num text-xs text-muted">{DEMO_USERS[r.role]}</span>
                  </span>
                  <span className="mt-1 block text-sm text-muted">{r.does}</span>
                </button>
              </form>
            ))}
            <details className="pt-2 text-sm text-muted">
              <summary className="cursor-pointer">Sign in with email instead</summary>
              <div className="mt-3">
                <SignInForm />
              </div>
            </details>
          </>
        ) : (
          <SignInForm />
        )}
      </section>
    </main>
  );
}
