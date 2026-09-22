import 'server-only';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { supabaseServer } from './supabase/server';
import type { FxRate, Role, Tenant } from './types';

export interface Session {
  userId: string;
  email: string;
  role: Role;
  displayName: string;
  tenant: Tenant;
  /** The tenant's business day (Africa/Khartoum by default), as YYYY-MM-DD. */
  today: string;
  todayRate: FxRate | null;
}

export const getSession = cache(async (): Promise<Session> => {
  const supabase = await supabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect('/login');

  const { data: membership } = await supabase
    .from('memberships')
    .select('role, display_name, tenant:tenants(*)')
    .eq('user_id', claims.claims.sub)
    .limit(1)
    .single<{ role: Role; display_name: string; tenant: Tenant }>();
  if (!membership) redirect('/login?error=no-membership');

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: membership.tenant.timezone }).format(new Date());
  const { data: todayRate } = await supabase
    .from('fx_rates')
    .select('id, rate_date, sdg_per_usd_e6, eur_per_usd_e6')
    .eq('tenant_id', membership.tenant.id)
    .eq('rate_date', today)
    .maybeSingle<FxRate>();

  return {
    userId: claims.claims.sub,
    email: String(claims.claims.email ?? ''),
    role: membership.role,
    displayName: membership.display_name,
    tenant: membership.tenant,
    today,
    todayRate: todayRate ?? null,
  };
});

export function can(session: Session, ...roles: Role[]) {
  return roles.includes(session.role);
}

export async function requireRole(...roles: Role[]) {
  const session = await getSession();
  if (!can(session, ...roles)) redirect('/');
  return session;
}
