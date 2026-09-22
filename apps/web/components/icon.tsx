import { ArrowRightLeft, Boxes, ChartColumn, Landmark, LayoutDashboard, ReceiptText, Users, type LucideIcon } from 'lucide-react';

// The manifest names icons as strings; only the ones it uses are bundled.
const ICONS: Record<string, LucideIcon> = { ArrowRightLeft, Boxes, ChartColumn, Landmark, LayoutDashboard, ReceiptText, Users };

export function Icon({ name, className }: { name: string; className?: string }) {
  const C = ICONS[name];
  return C ? <C className={className} aria-hidden /> : null;
}
