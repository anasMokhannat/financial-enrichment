import { Skeleton } from "@/components/Skeleton";

/**
 * Auto-shown by Next.js while /companies is server-fetching its data.
 * Approximates the final list shape so the layout doesn't reflow on
 * hand-off.
 */
export default function CompaniesLoading() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <Skeleton className="h-7 w-40" />
          <Skeleton className="mt-2 h-4 w-72" />
        </div>
        <Skeleton className="h-7 w-20 rounded-full" />
      </header>

      <div className="overflow-hidden rounded-card border border-surface-line bg-surface shadow-card">
        <div className="border-b border-surface-line bg-surface-sub px-4 py-3">
          <Skeleton className="h-3 w-32" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-surface-line px-4 py-3 last:border-b-0"
          >
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/5" />
            </div>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
