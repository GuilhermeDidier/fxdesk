'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '../../../lib/session';
import { supabaseServer } from '../../../lib/supabase/server';

const PROOF_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export async function recordPayment(_: string | null, form: FormData): Promise<string | null> {
  const s = await requireRole('owner', 'sales');
  const supabase = await supabaseServer();

  const amount = Number(String(form.get('amount') ?? '').replace(/[,\s]/g, ''));
  if (!Number.isSafeInteger(amount) || amount <= 0) return 'Enter the amount in whole pounds.';
  const txCode = String(form.get('tx_code') ?? '').trim();
  if (!txCode) return 'Enter the bank transaction code from the receipt.';

  let allocations: { order_id: string; amount_sdg: number }[] = [];
  try {
    allocations = JSON.parse(String(form.get('allocations') ?? '[]'));
  } catch {
    return 'Allocations could not be read.';
  }
  allocations = allocations.filter((a) => a.amount_sdg > 0);

  // Proof photo goes to the tenant's private folder first; the database checks the path.
  let proofPath: string | null = null;
  const proof = form.get('proof');
  if (proof instanceof File && proof.size > 0) {
    const ext = PROOF_TYPES[proof.type];
    if (!ext) return 'The proof must be a photo (JPG, PNG, WebP) or a PDF.';
    if (proof.size > 5 * 1024 * 1024) return 'The proof file is larger than 5 MB.';
    proofPath = `${s.tenant.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('payment-proofs').upload(proofPath, proof, { contentType: proof.type });
    if (error) return `Could not store the proof: ${error.message}`;
  }

  const { error } = await supabase.rpc('record_payment', {
    p_bank_account_id: String(form.get('bank_account_id') ?? ''),
    p_bank_tx_code: txCode,
    p_amount_sdg: amount,
    p_customer_id: String(form.get('customer_id') ?? ''),
    p_allocations: allocations,
    p_received_on: String(form.get('received_on') || s.today),
    p_proof_path: proofPath,
  });
  if (error) {
    if (proofPath) await supabase.storage.from('payment-proofs').remove([proofPath]);
    return error.message;
  }

  revalidatePath('/payments');
  revalidatePath('/orders');
  const back = String(form.get('return_to') ?? '');
  redirect(back.startsWith('/orders/') ? back : '/payments?recorded=1');
}
