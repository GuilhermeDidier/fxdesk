import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import pg from 'pg';

config({ path: new URL('../../../.env.local', import.meta.url).pathname });

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k}: db tests need a Supabase instance (see README)`);
  return v;
};

export const url = () => need('NEXT_PUBLIC_SUPABASE_URL');
export const anonKey = () => need('NEXT_PUBLIC_SUPABASE_ANON_KEY');

export function adminDb() {
  const cs = need('DATABASE_URL');
  return new pg.Client({ connectionString: cs, ssl: /localhost|127\.0\.0\.1/.test(cs) ? false : { rejectUnauthorized: false } });
}

export type Role = 'owner' | 'sales' | 'warehouse';

export interface World {
  tenantId: string;
  users: Record<Role, { id: string; client: SupabaseClient }>;
  products: { inverter: string; battery: string };
  customerId: string;
  accounts: string[];
  today: string;
  db: pg.Client;
  cleanup: () => Promise<void>;
}

/**
 * A fresh tenant with three users (one per role), the two products of the
 * worked example, a closed shipment, today's rate (8,012.5 / 0.9184) and the
 * rate of the day before (7,900 / 0.918).
 */
export async function buildWorld(label: string): Promise<World> {
  const admin = createClient(url(), need('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const db = adminDb();
  await db.connect();

  const run = `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const password = `pw-${run}-A1!`;
  const users = {} as World['users'];
  const userIds: string[] = [];

  const { rows: [tenant] } = await db.query(
    `insert into tenants (name, brand_name) values ($1, $1) returning id, (now() at time zone timezone)::date::text as today`,
    [`test-${run}`],
  );
  for (const role of ['owner', 'sales', 'warehouse'] as Role[]) {
    const email = `${role}.${run}@fxdesk.test`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    userIds.push(data.user.id);
    await db.query('insert into memberships (tenant_id, user_id, role, display_name) values ($1, $2, $3, $3)', [tenant.id, data.user.id, role]);
    const client = createClient(url(), anonKey(), { auth: { persistSession: false } });
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;
    users[role] = { id: data.user.id, client };
  }

  const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;
  await q(`insert into fx_rates (tenant_id, rate_date, sdg_per_usd_e6, eur_per_usd_e6) values
           ($1, $2::date, 8012500000, 918400), ($1, $2::date - 1, 7900000000, 918000)`, [tenant.id, tenant.today]);
  const [inv] = await q(`insert into products (tenant_id, sku, name, category, price_usd_cents) values ($1, 'INV', 'Inverter', 'inverter', 124900) returning id`, [tenant.id]);
  const [bat] = await q(`insert into products (tenant_id, sku, name, category, price_usd_cents) values ($1, 'BAT', 'Battery', 'battery', 189050) returning id`, [tenant.id]);
  const [cust] = await q(`insert into customers (tenant_id, name, phone) values ($1, 'Dealer', '+249912000000') returning id`, [tenant.id]);
  const accts = await q(`insert into bank_accounts (tenant_id, name, bank) select $1, 'ACC ' || g, 'Bank' from generate_series(1, 6) g returning id`, [tenant.id]);
  const [sh] = await q(`insert into shipments (tenant_id, reference, supplier) values ($1, 'SH-1', 'Supplier') returning id`, [tenant.id]);
  await q(`insert into shipment_lines (shipment_id, tenant_id, product_id, qty, unit_cost_usd_cents) values ($1, $2, $3, 50, 80000), ($1, $2, $4, 20, 120000)`, [sh.id, tenant.id, inv.id, bat.id]);
  await q(`insert into shipment_charges (shipment_id, tenant_id, kind, amount_usd_cents) values ($1, $2, 'freight', 100001), ($1, $2, 'customs', 50000)`, [sh.id, tenant.id]);
  const { error: closeError } = await users.owner.client.rpc('close_shipment', { p_shipment_id: sh.id });
  if (closeError) throw closeError;

  return {
    tenantId: tenant.id,
    users,
    products: { inverter: inv.id, battery: bat.id },
    customerId: cust.id,
    accounts: accts.map((a: { id: string }) => a.id),
    today: tenant.today,
    db,
    cleanup: async () => {
      await db.query('select private.purge_tenant($1)', [tenant.id]);
      await db.end();
      for (const id of userIds) await admin.auth.admin.deleteUser(id);
    },
  };
}

/** The worked example, expressed as create_order lines for this world. */
export function workedExampleLines(w: World) {
  return [
    { product_id: w.products.inverter, qty: 4, discount_bps: 200 },
    { product_id: w.products.battery, qty: 2, discount_bps: 450 },
  ];
}
