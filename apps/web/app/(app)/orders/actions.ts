'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { withDone } from '../../../lib/done';
import { getSession } from '../../../lib/session';
import { supabaseServer } from '../../../lib/supabase/server';

export interface NewOrder {
  customerId: string;
  note: string;
  lines: { productId: string; qty: number; discountBps: number }[];
  asQuote: boolean;
}

/**
 * Books the order (or writes the quote). Prices, discount rules and the rate
 * are applied by the database; nothing sent from the browser is trusted.
 */
export async function createOrder(input: NewOrder): Promise<{ error: string }> {
  const s = await getSession();
  const lines = input.lines.filter((l) => l.productId);
  if (!input.customerId) return { error: 'Choose a customer.' };
  if (lines.length === 0) return { error: 'Add at least one product.' };

  const supabase = await supabaseServer();
  const { data: id, error } = await supabase.rpc(input.asQuote ? 'create_quote' : 'create_order', {
    p_tenant_id: s.tenant.id,
    p_customer_id: input.customerId,
    p_lines: lines.map((l) => ({ product_id: l.productId, qty: l.qty, discount_bps: l.discountBps })),
    p_note: input.note.trim() || null,
  });
  if (error) return { error: error.message };

  const { data: o } = await supabase.from('orders').select('number, status').eq('id', id).single();
  revalidatePath('/orders');
  const message =
    o?.status === 'quote'
      ? `Quote #${o.number} saved`
      : o?.status === 'pending_approval'
        ? `Order #${o.number} sent to the owner for approval`
        : `Order #${o?.number} booked`;
  redirect(withDone(`/orders/${id}?booked=1`, message));
}

type OrderRpc = 'approve_order' | 'release_order' | 'cancel_order';
const DONE: Record<OrderRpc, string> = {
  approve_order: 'Discount approved. The customer can pay now.',
  release_order: 'Goods released and stock updated',
  cancel_order: 'Order cancelled',
};

async function orderAction(fn: OrderRpc, orderId: string) {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc(fn, { p_order_id: orderId });
  revalidatePath(`/orders/${orderId}`);
  revalidatePath('/orders');
  if (error) redirect(`/orders/${orderId}?error=${encodeURIComponent(error.message)}`);
  redirect(withDone(`/orders/${orderId}`, DONE[fn]));
}

export async function approveOrder(orderId: string) {
  await orderAction('approve_order', orderId);
}
export async function releaseOrder(orderId: string) {
  await orderAction('release_order', orderId);
}
export async function cancelOrder(orderId: string) {
  await orderAction('cancel_order', orderId);
}

/** The dealer said yes: book the quote as an order at today's rate. */
export async function convertQuote(quoteId: string) {
  const supabase = await supabaseServer();
  const { data: id, error } = await supabase.rpc('convert_quote', { p_quote_id: quoteId });
  revalidatePath('/orders');
  if (error) redirect(`/orders/${quoteId}?error=${encodeURIComponent(error.message)}`);
  const { data: o } = await supabase.from('orders').select('number').eq('id', id).single();
  redirect(withDone(`/orders/${id}?booked=1`, `Quote turned into order #${o?.number} at today's rate`));
}
