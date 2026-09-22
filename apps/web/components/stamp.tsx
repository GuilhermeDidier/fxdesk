/** Violet rubber stamp: marks values that are frozen in the books. */
export function Stamp({ label, lines, animate = false }: { label: string; lines: string[]; animate?: boolean }) {
  return (
    <div className={`stamp ${animate ? 'stamp-in' : ''}`} aria-label={`${label}: ${lines.join(', ')}`}>
      <span className="text-[13px] font-semibold tracking-[0.2em]">{label}</span>
      {lines.map((l) => (
        <span key={l} className="text-[10.5px] leading-tight opacity-90">
          {l}
        </span>
      ))}
    </div>
  );
}
