import { Skeleton } from "@/components/Skeleton";

/**
 * Default fallback for routes that don't define a more specific
 * loading.tsx. Approximates a hero card and a stats row.
 */
export default function RootLoading() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <Skeleton className="h-32 rounded-card" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-card" />
        ))}
      </div>
    </div>
  );
}
