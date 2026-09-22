import type { Order } from '../../../lib/types';

type OrderStage = Pick<Order, 'status' | 'paid_sdg' | 'total_sdg' | 'released_at'> & { converted_to?: string | null };

export function orderStage(o: OrderStage) {
  if (o.status === 'cancelled') return { label: 'Cancelled', tone: 'bg-paper text-muted' };
  if (o.status === 'quote') return o.converted_to ? { label: 'Quote accepted', tone: 'bg-paper text-muted' } : { label: 'Quote', tone: 'bg-stamp/10 text-stamp' };
  if (o.status === 'pending_approval') return { label: 'Needs approval', tone: 'bg-red text-white' };
  if (o.released_at) return { label: 'Released', tone: 'bg-ink text-white' };
  if (o.paid_sdg >= o.total_sdg) return { label: 'Ready to release', tone: 'bg-paid-wash text-paid' };
  if (o.paid_sdg > 0) return { label: 'Part paid', tone: 'bg-sand text-sand-ink' };
  return { label: 'Awaiting payment', tone: 'bg-paper text-muted' };
}

export function StatusBadge({ order }: { order: OrderStage }) {
  const { label, tone } = orderStage(order);
  return <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold ${tone}`}>{label}</span>;
}
