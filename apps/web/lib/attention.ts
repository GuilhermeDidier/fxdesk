import { formatSdg } from '@fxdesk/money';
import type { Role } from './types';

export interface AttentionItem {
  key: string;
  tone: 'red' | 'sand';
  title: string;
  detail: string;
  href: string;
}

export interface AttentionInput {
  role: Role;
  orders: { status: string; total_sdg: number; paid_sdg: number; released_at: string | null; converted_to?: string | null }[];
  accounts: { bank_account_id: string; name: string; daily_limit_sdg: number; received_today_sdg: number; remaining_today_sdg: number }[];
  lowStock: { sku: string; name: string; on_hand: number; min_stock: number }[];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The first screen of each role: only what that person can act on, worst first.
 * An account counts as near its limit from 80% of the day's allowance.
 */
export function buildAttention({ role, orders, accounts, lowStock }: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  const pending = orders.filter((o) => o.status === 'pending_approval').length;
  const ready = orders.filter((o) => o.status === 'confirmed' && o.paid_sdg >= o.total_sdg && !o.released_at).length;
  const quotes = orders.filter((o) => o.status === 'quote' && !o.converted_to).length;

  if (pending && (role === 'owner' || role === 'sales')) {
    items.push({
      key: 'approval',
      tone: 'red',
      title: `${plural(pending, 'order')} waiting for discount approval`,
      detail: role === 'owner' ? 'The customer cannot pay until you approve.' : 'The owner has to approve these before the customer pays.',
      href: '/orders?view=approval',
    });
  }
  if (ready && (role === 'owner' || role === 'warehouse')) {
    items.push({
      key: 'release',
      tone: 'sand',
      title: `${plural(ready, 'paid order')} ready to release`,
      detail: 'Paid in full. The goods can leave the warehouse.',
      href: '/orders?view=release',
    });
  }
  if (role === 'owner' || role === 'sales') {
    for (const a of accounts) {
      if (a.received_today_sdg < a.daily_limit_sdg * 0.8) continue;
      const full = a.remaining_today_sdg <= 0;
      items.push({
        key: `account-${a.bank_account_id}`,
        tone: full ? 'red' : 'sand',
        title: full ? `${a.name} has reached today's limit` : `${a.name} can take ${formatSdg(a.remaining_today_sdg)} more today`,
        detail: 'Send dealers to another account for the rest of the day.',
        href: '/payments',
      });
    }
  }
  if (quotes && (role === 'marketing' || role === 'sales' || role === 'owner')) {
    items.push({
      key: 'quotes',
      tone: 'sand',
      title: `${plural(quotes, 'quote')} waiting for the dealer's answer`,
      detail: 'Follow up, or turn the quote into an order when the dealer agrees.',
      href: '/orders?view=quotes',
    });
  }
  if (role !== 'marketing') {
    for (const p of lowStock) {
      items.push({
        key: `stock-${p.sku}`,
        tone: p.on_hand <= 0 ? 'red' : 'sand',
        title: p.on_hand <= 0 ? `${p.name} is out of stock` : `${p.name}: ${p.on_hand} left`,
        detail: `Minimum is ${p.min_stock}.`,
        href: '/stock',
      });
    }
  }
  return items.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'red' ? -1 : 1));
}
