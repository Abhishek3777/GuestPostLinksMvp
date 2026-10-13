export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <div className="h-7 w-72 animate-pulse rounded bg-surface-2" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl border border-border bg-surface" />
        ))}
      </div>
      <div className="h-96 animate-pulse rounded-xl border border-border bg-surface" />
    </div>
  );
}
