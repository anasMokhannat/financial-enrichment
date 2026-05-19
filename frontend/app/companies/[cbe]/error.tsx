"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

/**
 * Route-scoped error boundary for /companies/[cbe]. Recharts
 * occasionally throws on degenerate data (all-null statements,
 * negative-on-log-scale rows); without this, one bad chart takes the
 * whole detail page down. Now it's just one slot that swaps to a
 * recovery card with a route-aware "Back to list" link.
 */
export default function CompanyDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Company detail error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 rounded-card bg-surface px-6 py-12 text-center shadow-card ring-1 ring-surface-line">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-rose-50 text-rose-600">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div>
        <h1 className="text-lg font-semibold text-ink">
          Couldn&apos;t render this company
        </h1>
        <p className="mt-1 text-sm text-ink-subtle">
          {error.message || "Unexpected error while rendering the report."}
        </p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-full bg-brand-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-600"
        >
          <RotateCw className="h-4 w-4" />
          Try again
        </button>
        <Link
          href="/companies"
          className="inline-flex items-center rounded-full border border-surface-line bg-surface px-4 py-2 text-sm font-semibold text-ink-subtle transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
        >
          Back to list
        </Link>
      </div>
    </div>
  );
}
