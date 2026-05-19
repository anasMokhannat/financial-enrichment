"use client";

import { Building2, ChevronRight, MapPin, X } from "lucide-react";

import type { CandidateMatch } from "@/lib/types";

type Props = {
  query: string;
  candidates: CandidateMatch[];
  onPick: (cbe: string) => void;
  /** Optional dismiss handler. When provided, a Cancel pill appears in
   *  the header so the user can drop the candidate list and return to
   *  the search box without picking one. */
  onCancel?: () => void;
};

/**
 * Ambiguous-match dropdown. Shown when KBO returns several matches
 * for a name. Each candidate carries (when KBO exposes it) the
 * registered city + street, so the user can disambiguate companies
 * with identical names by location.
 */
export function AmbiguousMatches({ query, candidates, onPick, onCancel }: Props) {
  return (
    <div className="rounded-card bg-surface shadow-card ring-1 ring-surface-line">
      <header className="flex items-start justify-between gap-3 border-b border-surface-line px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-ink">
            {candidates.length} matches for{" "}
            <span className="text-brand-700">&ldquo;{query}&rdquo;</span>
          </h2>
          <p className="mt-0.5 text-xs text-ink-subtle">
            Pick the right company to load its full enrichment report.
          </p>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-surface-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-subtle transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
        )}
      </header>

      <ul className="divide-y divide-surface-line">
        {candidates.map((c) => (
          <li key={c.enterprise_number}>
            <button
              onClick={() => onPick(c.enterprise_number)}
              className="group flex w-full items-start justify-between gap-3 px-6 py-3.5 text-left transition hover:bg-brand-50/60"
            >
              <div className="flex flex-1 items-start gap-3 min-w-0">
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
                  <Building2 className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{c.name}</div>
                  <div className="font-mono text-xs text-ink-muted">
                    {c.enterprise_number}
                  </div>
                  {c.address && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-ink-subtle">
                      <MapPin className="h-3 w-3 shrink-0 text-ink-muted" />
                      <span className="truncate">{c.address}</span>
                    </div>
                  )}
                </div>
              </div>
              <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-ink-muted transition group-hover:translate-x-0.5 group-hover:text-brand-600" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
