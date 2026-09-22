'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Nav({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible" aria-label="Main">
      {items.map((item) => {
        const active = item.href === '/' ? path === '/' : path.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition ${
              active ? 'bg-ink text-white' : 'text-muted hover:bg-sheet hover:text-ink'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
