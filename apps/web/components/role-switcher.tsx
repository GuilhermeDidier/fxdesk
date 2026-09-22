import { signInDemo } from '../app/login/actions';
import { ROLES } from '../lib/manifest';
import type { Role } from '../lib/types';

/**
 * Demo only: see the same data as another person without going back to the
 * start. Each option signs in as that role's demo account, so what changes is
 * enforced by the database, not by hiding things on screen.
 */
export function RoleSwitcher({ active }: { active: Role }) {
  return (
    <div>
      <p className="eyebrow mb-1.5">See it as</p>
      <ul className="space-y-0.5">
        {ROLES.map((r) => (
          <li key={r.key}>
            {r.key === active ? (
              <span className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold">
                <span className="size-1.5 rounded-full bg-stamp" aria-hidden />
                {r.label}
              </span>
            ) : (
              <form action={signInDemo.bind(null, r.key)}>
                <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm text-muted hover:bg-sheet hover:text-ink" title={r.pitch}>
                  <span className="size-1.5 rounded-full bg-rule" aria-hidden />
                  {r.label}
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
