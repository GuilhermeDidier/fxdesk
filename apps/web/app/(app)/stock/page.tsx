import { formatUsd } from '@fxdesk/money';
import { can, getSession } from '../../../lib/session';
import { supabaseServer } from '../../../lib/supabase/server';

export const metadata = { title: 'Stock · FX Desk' };

interface Level {
  product_id: string;
  sku: string;
  name: string;
  category: string;
  on_hand: number;
  min_stock: number;
  below_min: boolean;
}
interface Shipment {
  id: string;
  reference: string;
  supplier: string;
  arrived_on: string | null;
  status: 'open' | 'closed';
  lines: { qty: number; unit_cost_usd_cents: number; allocated_charges_usd_cents: number | null; landed_unit_cost_usd_cents: number | null; product: { sku: string } }[];
  charges: { kind: string; amount_usd_cents: number }[];
}

export default async function StockPage() {
  const s = await getSession();
  const supabase = await supabaseServer();
  const [{ data: levels }, { data: shipments }, { data: costs }] = await Promise.all([
    supabase.from('stock_levels').select('*').order('sku').returns<Level[]>(),
    // RLS: only the owner gets rows back from shipments and product_costs.
    supabase
      .from('shipments')
      .select('id, reference, supplier, arrived_on, status, lines:shipment_lines(qty, unit_cost_usd_cents, allocated_charges_usd_cents, landed_unit_cost_usd_cents, product:products(sku)), charges:shipment_charges(kind, amount_usd_cents)')
      .order('reference', { ascending: false })
      .returns<Shipment[]>(),
    supabase.from('product_costs').select('product_id, avg_landed_cost_usd_cents'),
  ]);
  const avgCost = new Map((costs ?? []).map((c) => [c.product_id, c.avg_landed_cost_usd_cents as number]));
  const owner = can(s, 'owner');

  return (
    <>
      <header className="mb-6">
        <p className="eyebrow">Warehouse</p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Stock</h1>
      </header>

      <div className="sheet overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-rule">
              <th className="px-4 py-2 text-start font-normal">Product</th>
              <th className="px-2 py-2 text-end font-normal">On hand</th>
              <th className="px-2 py-2 text-end font-normal">Minimum</th>
              {owner && <th className="px-4 py-2 text-end font-normal">Landed cost / unit</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {(levels ?? []).map((l) => (
              <tr key={l.product_id} className={l.below_min ? 'bg-red-wash/40' : ''}>
                <td className="px-4 py-2.5">
                  <span className="num text-xs text-muted">{l.sku}</span> {l.name}
                </td>
                <td className={`num px-2 text-end font-medium ${l.below_min ? 'text-red' : ''}`}>{l.on_hand}</td>
                <td className="num px-2 text-end text-muted">{l.min_stock}</td>
                {owner && <td className="num px-4 text-end">{avgCost.has(l.product_id) ? formatUsd(avgCost.get(l.product_id)!) : '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {owner && (
        <section className="mt-10">
          <h2 className="font-display text-xl font-bold">Shipments</h2>
          <p className="mb-4 max-w-2xl text-sm text-muted">
            Freight, customs and transport are spread over every unit in proportion to its purchase value when a
            shipment is closed. Closed shipments are part of the books and cannot be edited.
          </p>
          <div className="grid gap-4 xl:grid-cols-2">
            {(shipments ?? []).map((sh) => {
              const charges = sh.charges.reduce((a, c) => a + c.amount_usd_cents, 0);
              const goods = sh.lines.reduce((a, l) => a + l.qty * l.unit_cost_usd_cents, 0);
              return (
                <article key={sh.id} className="sheet overflow-hidden">
                  <header className="flex items-baseline justify-between gap-3 border-b border-rule px-4 py-3">
                    <div>
                      <p className="num font-semibold">{sh.reference}</p>
                      <p className="text-xs text-muted">
                        {sh.supplier}
                        {sh.arrived_on ? ` · arrived ${sh.arrived_on}` : ' · in transit'}
                      </p>
                    </div>
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${sh.status === 'closed' ? 'bg-ink text-white' : 'bg-sand text-sand-ink'}`}>
                      {sh.status === 'closed' ? 'Closed' : 'Open'}
                    </span>
                  </header>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[420px] text-xs">
                      <thead className="text-muted">
                        <tr>
                          <th className="px-4 py-1.5 text-start font-normal">SKU</th>
                          <th className="px-2 py-1.5 text-end font-normal">Qty</th>
                          <th className="px-2 py-1.5 text-end font-normal">Purchase</th>
                          <th className="px-2 py-1.5 text-end font-normal">+ charges</th>
                          <th className="px-4 py-1.5 text-end font-normal">Landed / unit</th>
                        </tr>
                      </thead>
                      <tbody className="num divide-y divide-rule">
                        {sh.lines.map((l) => (
                          <tr key={l.product.sku}>
                            <td className="px-4 py-1.5">{l.product.sku}</td>
                            <td className="px-2 text-end">{l.qty}</td>
                            <td className="px-2 text-end">{formatUsd(l.unit_cost_usd_cents)}</td>
                            <td className="px-2 text-end text-muted">{l.allocated_charges_usd_cents === null ? '—' : formatUsd(l.allocated_charges_usd_cents)}</td>
                            <td className="px-4 text-end font-semibold">{l.landed_unit_cost_usd_cents === null ? '—' : formatUsd(l.landed_unit_cost_usd_cents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <footer className="num flex flex-wrap gap-x-4 gap-y-1 border-t border-rule px-4 py-2 text-xs text-muted">
                    <span>Goods {formatUsd(goods)}</span>
                    {sh.charges.map((c, i) => (
                      <span key={i}>
                        {c.kind} {formatUsd(c.amount_usd_cents)}
                      </span>
                    ))}
                    <span className="font-semibold text-ink">Charges {formatUsd(charges)}</span>
                  </footer>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
