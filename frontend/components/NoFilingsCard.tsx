import { FileX } from "lucide-react";
import Link from "next/link";

/**
 * Rendered when KBO knows the company but NBB has no annual filings.
 * The company is NOT persisted in Supabase in this case — the user
 * sees this message and can navigate away or try a different query.
 */
export function NoFilingsCard({
  cbe,
  name,
}: {
  cbe: string;
  name: string | null;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <section className="rounded-card bg-surface px-6 py-10 text-center shadow-card ring-1 ring-surface-line">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-amber-50 text-amber-600">
          <FileX className="h-5 w-5" />
        </div>
        <h1 className="text-lg font-semibold text-ink">No filings found</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-subtle">
          {name ? <strong>{name}</strong> : `CBE ${cbe}`} is registered in
          KBO but has no annual accounts deposited with the NBB. There&apos;s
          nothing to extract, so this company was not added to the cache.
        </p>
        <p className="mt-3 font-mono text-[11px] text-ink-muted">{cbe}</p>
        <Link
          href="/search"
          className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-brand-600"
        >
          Search another company
        </Link>
      </section>
    </div>
  );
}
