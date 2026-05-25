import { Building2, Clock, FileSpreadsheet } from "lucide-react";

import { HeroCard } from "@/components/HeroCard";
import { RecentCompaniesStrip } from "@/components/RecentCompaniesStrip";
import { StatCard } from "@/components/StatCard";
import { EnrichmentRepository } from "@/lib/server/db/repository";
import type { StatsResponse } from "@/lib/types";

// Counts come from Supabase and change whenever the cache is written
// to or cleared. Opt out of static rendering so the page always
// re-queries on each request instead of serving a build-time snapshot.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Overview page. Hero banner + three stat tiles fed by Supabase
 * (companies + filings counts, plus the timestamp of the most recent
 * extraction). If Supabase isn't configured we render em-dashes and
 * a hint rather than crashing.
 *
 * Calls the repository directly rather than the /api/stats route —
 * skips a same-runtime HTTP round-trip and dodges Vercel Deployment
 * Protection, which would 401 on SSR fetches to our own deployment.
 */
export default async function OverviewPage() {
  let stats: StatsResponse | null = null;
  let error: string | null = null;
  const repo = EnrichmentRepository.create();
  if (repo === null) {
    error =
      "Supabase isn't configured — stats are unavailable. See frontend/supabase/README.md.";
  } else {
    try {
      const [companies, statements, latest] = await Promise.all([
        repo.countCompanies(),
        repo.countStatements(),
        repo.latestExtractionAt(),
      ]);
      stats = {
        companies_cached: companies,
        filings_extracted: statements,
        last_extraction_at: latest,
      };
    } catch (err) {
      error = err instanceof Error ? err.message : "Unknown error";
    }
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
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
