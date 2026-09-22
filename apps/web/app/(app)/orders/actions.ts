'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getSession } from '../../../lib/session';
import { supabaseServer } from '../../../lib/supabase/server';

export interface NewOrder {
  customerId: string;
  note: string;
  lines: { productId: string; qty: number; discountBps: number }[];
}

/** Books the order. Prices, discount rules and the rate are applied by the database, not trusted from here. */
export async function createOrder(input: NewOrder): Promise<{ error: string } | never> {
  const s = await getSession();
  const lines = input.lines.filter((l) => l.productId);
  if (!input.customerId) return { error: 'Choose a customer.' };
  if (lines.length === 0) return { error: 'Add at least one product.' };

  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('create_order', {
    p_tenant_id: s.tenant.id,
    p_customer_id: input.customerId,
    p_lines: lines.map((l) => ({ product_id: l.productId, qty: l.qty, discount_bps: l.discountBps })),
    p_note: input.note.trim() || null,
  });
  if (error) return { error: error.message };

  revalidatePath('/orders');
  redirect(`/orders/${data}?booked=1`);
}

async function orderAction(fn: 'approve_order' | 'release_order' | 'cancel_order', orderId: string) {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc(fn, { p_order_id: orderId });
  revalidatePath(`/orders/${orderId}`);
  revalidatePath('/orders');
  if (error) redirect(`/orders/${orderId}?error=${encodeURIComponent(error.message)}`);
  redirect(`/orders/${orderId}`);
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
