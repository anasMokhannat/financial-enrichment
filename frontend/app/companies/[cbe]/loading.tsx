import { Skeleton } from "@/components/Skeleton";

/**
 * Shown while /companies/[cbe] is server-fetching. The pipeline can
 * take 10–20 s on a cache miss, so a representative skeleton matters
 * more here than on cached pages.
 */
export default function CompanyDetailLoading() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="rounded-card bg-surface px-6 py-6 shadow-card ring-1 ring-surface-line">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <Skeleton className="h-9 w-28 rounded-full" />
        </div>
      </header>

      <section className="rounded-card bg-surface px-6 py-5 shadow-card ring-1 ring-surface-line">
        <Skeleton className="mb-4 h-5 w-40" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-20" />
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-card bg-surface px-6 py-5 shadow-card ring-1 ring-surface-line">
        <Skeleton className="mb-4 h-5 w-40" />
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, gi) => (
            <div key={gi}>
              <Skeleton className="mb-2 h-3 w-32" />
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 rounded-card" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-card bg-surface px-6 py-5 shadow-card ring-1 ring-surface-line">
        <div className="mb-5 flex gap-1 border-b border-surface-line">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-24 rounded-md" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </section>
    </div>
  );
}
