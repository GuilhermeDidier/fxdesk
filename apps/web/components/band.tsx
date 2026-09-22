import type { DiscountBand } from '@fxdesk/money';

const styles: Record<DiscountBand, string> = {
  none: 'bg-paper text-muted',
  sand: 'bg-sand text-sand-ink',
  red: 'bg-red-wash text-red',
  blocked: 'bg-red text-white',
};
const labels: Record<DiscountBand, string> = {
  none: 'No discount',
  sand: 'Sand',
  red: 'Red',
  blocked: 'Needs owner',
};

export function BandChip({ band }: { band: DiscountBand }) {
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wide ${styles[band]}`}>
      {labels[band]}
    </span>
  );
}
