import Link from "next/link";

export default function CompanyNotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 rounded-card bg-surface px-6 py-12 text-center shadow-card ring-1 ring-surface-line">
      <h1 className="text-xl font-semibold text-ink">Company not found</h1>
      <p className="text-sm text-ink-subtle">
        The CBE number you opened is not in the cache, and the live KBO
        / NBB lookup also returned no result.
      </p>
      <Link
        href="/search"
        className="rounded-full bg-brand-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-600"
      >
        Try another search
      </Link>
    </div>
  );
}
