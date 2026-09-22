// Shaped like the pages it stands in for (title, filters, a table), not a spinner.
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-pulse">
      <div className="h-3 w-24 rounded bg-rule/70" />
      <div className="mt-3 h-8 w-56 rounded bg-rule" />
      <div className="mt-8 flex gap-2">
        {[72, 120, 104].map((w) => (
          <div key={w} className="h-7 rounded-full bg-rule/60" style={{ width: w }} />
        ))}
      </div>
      <div className="sheet mt-4 divide-y divide-rule">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3.5">
            <div className="h-3 w-10 rounded bg-rule/70" />
            <div className="h-3 flex-1 rounded bg-rule/50" />
            <div className="h-3 w-24 rounded bg-rule/70" />
          </div>
        ))}
      </div>
    </div>
  );
}
