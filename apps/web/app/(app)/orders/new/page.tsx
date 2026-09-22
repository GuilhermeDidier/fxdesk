import { requireRole } from '../../../../lib/session';
import { supabaseServer } from '../../../../lib/supabase/server';
import type { Customer, Product } from '../../../../lib/types';
import { OrderForm } from './order-form';

export const metadata = { title: 'New order · FX Desk' };

export default async function NewOrderPage() {
  const s = await requireRole('owner', 'sales');
  const supabase = await supabaseServer();
  const [{ data: customers }, { data: products }, { data: stock }] = await Promise.all([
    supabase.from('customers').select('id, name, city, phone, labels').order('name'),
    supabase.from('products').select('id, sku, name, category, price_usd_cents, min_stock').eq('active', true).order('sku'),
    supabase.from('stock_levels').select('product_id, on_hand'),
  ]);

  return (
    <>
      <header className="mb-6">
        <p className="eyebrow">Orders</p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">New order</h1>
      </header>
      <OrderForm
        customers={(customers ?? []) as Customer[]}
        products={(products ?? []) as Product[]}
        onHand={Object.fromEntries((stock ?? []).map((r) => [r.product_id, r.on_hand as number]))}
        policy={{ sandMaxBps: s.tenant.sand_max_bps, redMaxBps: s.tenant.red_max_bps }}
        maxTransferSdg={s.tenant.max_transfer_sdg}
        rate={s.todayRate}
        today={s.today}
      />
    </>
  );
}
