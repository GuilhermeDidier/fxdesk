import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { env } from '../../../../lib/env';

// Demo only: Vercel Cron calls this once a day so the public demo always has a
// rate for today (the pound keeps sliding ~0.1% a day). A real tenant enters
// its rate by hand on /rates. It also keeps the free Supabase project awake.
export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false } });
  const { data: tenants } = await admin.from('tenants').select('id, timezone').eq('name', 'demo');

  const results = [];
  for (const t of tenants ?? []) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: t.timezone }).format(new Date());
    const { data: last } = await admin
      .from('fx_rates')
      .select('rate_date, sdg_per_usd_e6, eur_per_usd_e6')
      .eq('tenant_id', t.id)
      .order('rate_date', { ascending: false })
      .limit(1)
      .single();
    if (!last || last.rate_date >= today) {
      results.push({ tenant: t.id, skipped: true });
      continue;
    }
    // +0.1% a day, rounded to half a pound
    const next = Math.round((last.sdg_per_usd_e6 * 1.001) / 500_000) * 500_000;
    const { error } = await admin.from('fx_rates').insert({
      tenant_id: t.id,
      rate_date: today,
      sdg_per_usd_e6: next,
      eur_per_usd_e6: last.eur_per_usd_e6,
      source: 'demo-cron',
    });
    results.push({ tenant: t.id, rate_date: today, error: error?.message });
  }
  return NextResponse.json({ results });
}
