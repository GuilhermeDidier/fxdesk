'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { PageDef } from '../lib/manifest';
import { Icon } from './icon';

export function Nav({ items }: { items: PageDef[] }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible" aria-label="Main">
      {items.map((item) => {
        const active = item.href === '/' ? path === '/' : path === item.href || path.startsWith(item.href + '/');
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition ${
              active ? 'bg-ink text-white' : 'text-muted hover:bg-sheet hover:text-ink'
            }`}
          >
            <Icon name={item.icon} className="size-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
