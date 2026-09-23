/**
 * Creates (or recreates) the public demo: one tenant, five users, 90 days of
 * history. Safe to rerun: the previous demo tenant is purged first.
 *
 *   npx tsx scripts/seed.ts
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL and
 * DEMO_PASSWORD (in .env.local or the environment).
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

config({ path: '.env.local' });
const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k}`);
  return v;
};

const USERS = [
  { key: 'owner', email: 'owner@fxdesk.demo', name: 'Hassan Idris', role: 'owner' },
  { key: 'sales', email: 'sales@fxdesk.demo', name: 'Amna Osman', role: 'sales' },
  { key: 'sales2', email: 'sales2@fxdesk.demo', name: 'Yousif Ali', role: 'sales' },
  { key: 'warehouse', email: 'warehouse@fxdesk.demo', name: 'Omer Babiker', role: 'warehouse' },
  { key: 'marketing', email: 'marketing@fxdesk.demo', name: 'Sara Mahgoub', role: 'marketing' },
] as const;

async function main() {
  const admin = createClient(need('NEXT_PUBLIC_SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });
  const password = need('DEMO_PASSWORD');

  const ids: Record<string, string> = {};
  const { data: existing } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of USERS) {
    const found = existing?.users.find((x) => x.email === u.email);
    if (found) {
      await admin.auth.admin.updateUserById(found.id, { password });
      ids[u.key] = found.id;
    } else {
      const { data, error } = await admin.auth.admin.createUser({ email: u.email, password, email_confirm: true });
      if (error) throw error;
      ids[u.key] = data.user.id;
    }
  }

  const db = new pg.Client({ connectionString: need('DATABASE_URL'), ssl: /localhost|127\.0\.0\.1/.test(need('DATABASE_URL')) ? false : { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query('begin');
    const old = await db.query(`select id from public.tenants where name = 'demo'`);
    for (const row of old.rows) await db.query('select private.purge_tenant($1)', [row.id]);

    const { rows } = await db.query(
      `insert into public.tenants (name, brand_name, brand_color, min_sdg_per_usd_e6)
       values ('demo', 'Nile Solar Supply', '#0e5566', 6000000000) returning id`,
    );
    const tenant = rows[0].id as string;
    for (const u of USERS) {
      await db.query('insert into public.memberships (tenant_id, user_id, role, display_name) values ($1, $2, $3, $4)', [
        tenant, ids[u.key], u.role, u.name,
      ]);
    }
    for (const [k, v] of Object.entries({ tenant, ...ids })) {
      await db.query('select set_config($1, $2, true)', [`seed.${k}`, v]);
    }
    await db.query(readFileSync(join(__dirname, '../supabase/seed/demo.sql'), 'utf8'));
    await db.query('commit');

    const { rows: stats } = await db.query(
      `select (select count(*) from orders where tenant_id = $1) orders,
              (select count(*) from payments where tenant_id = $1) payments,
              (select count(*) from fx_rates where tenant_id = $1) rates`,
      [tenant],
    );
    console.log('Seeded demo tenant', tenant, stats[0]);
  } catch (e) {
    await db.query('rollback');
    throw e;
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
