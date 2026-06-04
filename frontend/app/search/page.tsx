"use client";

import { AlertCircle, Search as SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AmbiguousMatches } from "@/components/AmbiguousMatches";
import { CompanyReportCard } from "@/components/CompanyReportCard";
import { CountrySelector } from "@/components/CountrySelector";
import { FilingsSelect } from "@/components/FilingsSelect";
import { RecentSearches } from "@/components/RecentSearches";
import { SearchBox } from "@/components/SearchBox";
import { ApiError, AmbiguousMatchApiError, api } from "@/lib/api";
import type { Country } from "@/lib/types";
import {
  pushRecent,
  readRecents,
  type RecentSearch,
  type RecentSearchStatus,
} from "@/lib/recentSearches";
import type { CandidateMatch, CompanyFinancialReport } from "@/lib/types";

type State =
  | { kind: "idle" }
  | { kind: "loading"; query: string }
  | { kind: "single"; query: string; report: CompanyFinancialReport; fromCache: boolean }
  | { kind: "ambiguous"; query: string; candidates: CandidateMatch[] }
  | { kind: "not_found"; query: string; message: string }
  | { kind: "error"; query: string; message: string };

const DEFAULT_FILINGS = 5;

export default function SearchPage() {
  const router = useRouter();
  const [country, setCountry] = useState<Country>("BE");
  const [query, setQuery] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [filings, setFilings] = useState<number>(DEFAULT_FILINGS);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [recents, setRecents] = useState<RecentSearch[]>([]);

  // localStorage isn't available during SSR, so load on mount.
  useEffect(() => {
    setRecents(readRecents());
  }, []);

  function record(
    q: string,
    status: RecentSearchStatus,
    extras?: { enterprise_number?: string; resolved_name?: string | null }
  ) {
    const next = pushRecent({
      query: q,
      status,
      enterprise_number: extras?.enterprise_number,
      resolved_name: extras?.resolved_name ?? undefined,
      searched_at: new Date().toISOString(),
    });
    setRecents(next);
  }

  async function runSearch(q: string) {
    if (!q) return;
    setState({ kind: "loading", query: q });
    try {
      const resp = await api.search(q, {
        filings,
        country,
        // Postcode only narrows KBO name-search; INPI uses SIREN
        // directly and ignores the field.
        postalCode: country === "BE" ? postalCode.trim() || undefined : undefined,
      });
      if (resp.report) {
        setState({
          kind: "single",
          query: q,
          report: resp.report,
          fromCache: resp.from_cache,
        });
        record(q, "ok", {
          enterprise_number: resp.report.company.enterprise_number,
          resolved_name: resp.report.company.name,
        });
        return;
      }
      if (resp.candidates && resp.candidates.length > 0) {
        setState({ kind: "ambiguous", query: q, candidates: resp.candidates });
        record(q, "ambiguous");
        return;
      }
      setState({
        kind: "not_found",
        query: q,
        message: "No match found for this query.",
      });
      record(q, "not_found");
    } catch (err) {
      if (err instanceof AmbiguousMatchApiError) {
        setState({ kind: "ambiguous", query: q, candidates: err.candidates });
        record(q, "ambiguous");
        return;
      }
      if (err instanceof ApiError && err.status === 404) {
        const message =
          typeof err.body === "object" &&
          err.body &&
          "detail" in (err.body as Record<string, unknown>)
            ? String((err.body as { detail: unknown }).detail)
            : "Company not found.";
        setState({ kind: "not_found", query: q, message });
        record(q, "not_found");
        return;
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      setState({ kind: "error", query: q, message });
      // Don't record `error` to history — network blips shouldn't pollute the list.
    }
  }

  function pickCandidate(cbe: string) {
    router.push(`/companies/${cbe}`);
  }

  function reRunFromRecent(q: string) {
    setQuery(q);
    runSearch(q);
  }

  const isLoading = state.kind === "loading";

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <header>
        <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-brand-700">
          <SearchIcon className="h-3.5 w-3.5" />
          Lookup
        </div>
        <h1 className="text-2xl font-bold text-ink">Search a company</h1>
        <p className="mt-1 text-sm text-ink-subtle">
          Resolve a name or CBE number to its legal profile and the
          most recent annual filings.
        </p>
      </header>

      <CountrySelector value={country} onChange={setCountry} />

      <SearchBox
        value={query}
        onChange={setQuery}
        postalCode={postalCode}
        onPostalCodeChange={setPostalCode}
        showPostalCode={country === "BE"}
        placeholder={
          country === "BE"
            ? "Company name or 10-digit CBE…"
            : "SIREN (9 digits) — e.g. 552 100 554"
        }
        onSubmit={() => runSearch(query.trim())}
        isLoading={isLoading}
      />

      <div className="flex flex-wrap items-center gap-3">
        <FilingsSelect value={filings} onChange={setFilings} />
        <p className="text-xs text-ink-muted">
          How many of the most recent annual filings to extract for this lookup.
        </p>
      </div>

      {state.kind === "single" && (
        <CompanyReportCard report={state.report} fromCache={state.fromCache} />
      )}

      {state.kind === "ambiguous" && (
        <AmbiguousMatches
          query={state.query}
          candidates={state.candidates}
          onPick={pickCandidate}
          onCancel={() => setState({ kind: "idle" })}
        />
      )}

      {state.kind === "not_found" && (
        <Banner tone="warn" title="No match found" body={state.message} />
      )}

      {state.kind === "error" && (
        <Banner tone="error" title="Search failed" body={state.message} />
      )}

      <RecentSearches
        items={recents}
        onChange={setRecents}
        onPick={reRunFromRecent}
      />
    </div>
  );
}

function Banner({
  tone,
  title,
  body,
}: {
  tone: "warn" | "error";
  title: string;
  body: string;
}) {
  const palette =
    tone === "warn"
      ? "bg-amber-50 text-amber-900 ring-amber-200"
      : "bg-rose-50 text-rose-900 ring-rose-200";
  return (
    <div
      className={`flex items-start gap-3 rounded-card px-5 py-4 shadow-card ring-1 ${palette}`}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <p className="mt-0.5 text-xs">{body}</p>
      </div>
    </div>
  );
}
