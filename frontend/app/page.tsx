import { Building2, Clock, FileSpreadsheet } from "lucide-react";

import { HeroCard } from "@/components/HeroCard";
import { RecentCompaniesStrip } from "@/components/RecentCompaniesStrip";
import { StatCard } from "@/components/StatCard";
import { ApiError, api } from "@/lib/api";
import type { StatsResponse } from "@/lib/types";

/**
 * Overview page. Hero banner + three stat tiles fed by the backend's
 * `/stats` endpoint (counts companies and filings stored in Supabase,
 * plus the timestamp of the most recent extraction).
 *
 * If Supabase isn't configured the backend returns 503; we render
 * em-dashes and a hint rather than crashing.
 */
export default async function OverviewPage() {
  let stats: StatsResponse | null = null;
  let error: string | null = null;
  try {
    stats = await api.stats();
  } catch (err) {
    if (err instanceof ApiError && err.status === 503) {
      error =
        "Supabase isn't configured — stats are unavailable. See backend/supabase/SETUP.md.";
    } else if (err instanceof Error) {
      error = err.message;
    } else {
      error = "Unknown error";
    }
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <HeroCard
        title="Enrichment Overview"
        subtitle="Search Belgian companies and extract their legal profile + financials."
        ctaLabel="Find Company"
        ctaHref="/search"
      />

      {error && (
        <div className="rounded-card bg-amber-50 px-5 py-4 text-sm text-amber-900 shadow-card ring-1 ring-amber-200">
          {error}
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          accent="cyan"
          icon={Building2}
          value={stats ? stats.companies_cached.toLocaleString() : "—"}
          label="Companies stored"
          caption="in Supabase enrichment store"
        />
        <StatCard
          accent="emerald"
          icon={FileSpreadsheet}
          value={stats ? stats.filings_extracted.toLocaleString() : "—"}
          label="Filings extracted"
          caption="annual accounts processed"
        />
        <StatCard
          accent="violet"
          icon={Clock}
          value={formatRelative(stats?.last_extraction_at)}
          label="Last extraction"
          caption={
            stats?.last_extraction_at
              ? new Date(stats.last_extraction_at).toLocaleString()
              : "no extractions yet"
          }
        />
      </section>

      <RecentCompaniesStrip />
    </div>
  );
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} d ago`;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
