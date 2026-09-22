'use server';
import { parseRate } from '@fxdesk/money';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { withDone } from '../../../lib/done';
import { requireRole } from '../../../lib/session';
import { supabaseServer } from '../../../lib/supabase/server';

export async function setTodayRate(_: string | null, form: FormData): Promise<string | null> {
  const s = await requireRole('owner');
  let sdg: number, eur: number;
  try {
    sdg = parseRate(String(form.get('sdg') ?? ''));
    eur = parseRate(String(form.get('eur') ?? ''));
  } catch {
    return 'Enter both rates as numbers, e.g. 8012.5 and 0.9184.';
  }
  if (sdg < s.tenant.min_sdg_per_usd_e6) return 'That pound rate is below the minimum set for this company.';

  const supabase = await supabaseServer();
  const row = { tenant_id: s.tenant.id, rate_date: s.today, sdg_per_usd_e6: sdg, eur_per_usd_e6: eur, source: 'manual' };
  const { error } = s.todayRate
    ? await supabase.from('fx_rates').update(row).eq('id', s.todayRate.id)
    : await supabase.from('fx_rates').insert(row);
  if (error) return error.message;

  revalidatePath('/', 'layout');
  redirect(withDone('/rates', `Rate of ${s.today} saved`));
}
