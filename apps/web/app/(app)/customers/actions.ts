'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { normalizeLabels } from '../../../lib/customers';
import { withDone } from '../../../lib/done';
import { getSession } from '../../../lib/session';
import { supabaseServer } from '../../../lib/supabase/server';

export async function createCustomer(_: string | null, form: FormData): Promise<string | null> {
  const s = await getSession();
  const name = String(form.get('name') ?? '').trim();
  if (name.length < 2) return 'Enter the dealer or installer name.';
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from('customers')
    .insert({
      tenant_id: s.tenant.id,
      name,
      city: String(form.get('city') ?? '').trim() || null,
      phone: String(form.get('phone') ?? '').trim() || null,
      labels: normalizeLabels(String(form.get('labels') ?? '').split(',')),
    })
    .select('id')
    .single();
  // RLS refuses roles that may not add customers; say so plainly
  if (error) return error.code === '42501' ? 'Your role cannot add customers.' : error.message;
  revalidatePath('/customers');
  redirect(withDone(`/customers/${data.id}`, `${name} added`));
}

export async function saveLabels(customerId: string, form: FormData) {
  const labels = normalizeLabels(String(form.get('labels') ?? '').split(','));
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from('customers').update({ labels }).eq('id', customerId).select('id');
  revalidatePath(`/customers/${customerId}`);
  revalidatePath('/customers');
  if (error || !data?.length) redirect(`/customers/${customerId}?error=${encodeURIComponent(error?.message ?? 'Your role cannot edit customers.')}`);
  redirect(withDone(`/customers/${customerId}`, 'Labels saved'));
}
