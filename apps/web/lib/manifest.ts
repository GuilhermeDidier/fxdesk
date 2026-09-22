import type { Role } from './types';

/**
 * One place decides what each role is, what it sees in the navigation and
 * which routes it can open. Pages call `canAccess` through `requireAccess`, so
 * a route missing from a role's list is unreachable by typing the URL too.
 * (Data access is enforced again, independently, by RLS in the database.)
 */

export interface RoleDef {
  key: Role;
  label: string;
  /** One line, from the job post's own words: what this person does. */
  pitch: string;
  landing: string;
}

export interface PageDef {
  href: string;
  label: string;
  /** lucide icon name; a string so the list can cross into client components */
  icon: string;
}

export const ROLES: RoleDef[] = [
  {
    key: 'sales',
    label: 'Sales adviser',
    pitch: 'Books orders at fixed dollar prices and records every transfer. Never sees a cost price.',
    landing: '/orders/new',
  },
  {
    key: 'owner',
    label: 'Owner',
    pitch: 'Sets the rate of the day, approves discounts above 5%, sees profit in dollars and euros.',
    landing: '/',
  },
  {
    key: 'warehouse',
    label: 'Warehouse',
    pitch: 'Releases goods, and only for orders that are paid in full.',
    landing: '/orders?view=release',
  },
  {
    key: 'marketing',
    label: 'Marketing',
    pitch: 'Keeps the dealer list, labels and history, follows up on open quotes.',
    landing: '/customers',
  },
];

const OVERVIEW = { href: '/', label: 'Overview', icon: 'LayoutDashboard' };
const ORDERS = { href: '/orders', label: 'Orders', icon: 'ReceiptText' };
const CUSTOMERS = { href: '/customers', label: 'Customers', icon: 'Users' };
const PAYMENTS = { href: '/payments', label: 'Payments', icon: 'Landmark' };
const STOCK = { href: '/stock', label: 'Stock', icon: 'Boxes' };
const PROFIT = { href: '/reports', label: 'Profit', icon: 'ChartColumn' };
const RATES = { href: '/rates', label: 'Rates', icon: 'ArrowRightLeft' };

export const MANIFEST: Record<Role, PageDef[]> = {
  owner: [OVERVIEW, ORDERS, CUSTOMERS, PAYMENTS, STOCK, PROFIT, RATES],
  sales: [OVERVIEW, ORDERS, CUSTOMERS, PAYMENTS, STOCK],
  warehouse: [OVERVIEW, ORDERS, STOCK],
  marketing: [OVERVIEW, CUSTOMERS, ORDERS],
};

/**
 * Writing routes live under a readable section but need more than read access.
 * Anything not listed here inherits the access of its section.
 */
const WRITE_ROUTES: { prefix: string; roles: Role[] }[] = [
  { prefix: '/orders/new', roles: ['owner', 'sales'] },
  { prefix: '/payments/new', roles: ['owner', 'sales'] },
];

export function canAccess(role: Role, path: string): boolean {
  const pathname = path.split('?')[0];
  const write = WRITE_ROUTES.find((w) => pathname.startsWith(w.prefix));
  if (write) return write.roles.includes(role);
  return MANIFEST[role].some((p) => (p.href === '/' ? pathname === '/' : pathname === p.href || pathname.startsWith(p.href + '/')));
}

export function roleDef(role: Role): RoleDef {
  const def = ROLES.find((r) => r.key === role);
  if (!def) throw new Error(`Unknown role ${role}`);
  return def;
}
