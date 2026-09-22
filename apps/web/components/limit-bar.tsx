import { formatSdg } from '@fxdesk/money';

/** How much of an account's daily receiving limit is used. */
export function LimitBar({ used, limit }: { used: number; limit: number }) {
  const pct = Math.min(100, (used / limit) * 100);
  const tone = pct >= 100 ? 'bg-red' : pct >= 80 ? 'bg-sand-ink' : 'bg-brand';
  return (
    <div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-paper">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="num mt-1 text-xs text-muted">
        {formatSdg(used)} of {formatSdg(limit)}
      </p>
    </div>
  );
}
