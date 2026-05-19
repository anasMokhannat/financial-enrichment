"use client";

import {
  ArrowRight,
  Building2,
  Clock,
  FileText,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Skeleton } from "@/components/Skeleton";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { CompanyListItem } from "@/lib/types";

const LIMIT = 8;

type State =
  | { kind: "loading" }
  | { kind: "ready"; items: CompanyListItem[]; total: number }
  | { kind: "error"; message: string }
  | { kind: "unavailable" };

/**
 * Compact strip of the most recently refreshed companies. Reuses
 * GET /companies?limit=8 (ordered by last_refreshed_at DESC) so no
 * new endpoint is needed.
 *
 * Three states it renders:
 *   - loading    → skeleton tiles in the same grid shape
 *   - empty      → friendly nudge linking to Search + Bulk
 *   - populated  → up to 8 clickable cards, each linking to its detail
 *   - 503        → service-unavailable note (Supabase off)
 */
export function RecentCompaniesStrip() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await api.listCompanies({ limit: LIMIT });
        if (!cancelled) {
          setState({ kind: "ready", items: resp.items, total: resp.total });
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 503) {
          setState({ kind: "unavailable" });
        } else {
          const msg = err instanceof Error ? err.message : "Unknown error";
          setState({ kind: "error", message: msg });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section>
      <Header total={state.kind === "ready" ? state.total : null} />

      {state.kind === "loading" && <LoadingGrid />}
      {state.kind === "unavailable" && (
        <Notice
          tone="warn"
          body="Supabase isn't configured — the recent-companies feed needs the cache."
        />
      )}
      {state.kind === "error" && <Notice tone="error" body={state.message} />}
      {state.kind === "ready" && state.items.length === 0 && <EmptyState />}
      {state.kind === "ready" && state.items.length > 0 && (
        <Grid items={state.items} />
      )}
    </section>
  );
}

function Header({ total }: { total: number | null }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-ink-muted">
          <Clock className="h-3.5 w-3.5" />
          Recently enriched
        </div>
        <h2 className="text-lg font-semibold text-ink">
          Latest companies in the cache
        </h2>
      </div>
      <Link
        href="/companies"
        className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 transition hover:text-brand-800"
      >
        View all{total !== null && total > 0 ? ` (${total})` : ""}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function Grid({ items }: { items: CompanyListItem[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((c) => (
        <Card key={c.enterprise_number} item={c} />
      ))}
    </div>
  );
}

function Card({ item }: { item: CompanyListItem }) {
  const dissolved = item.dissolution_date !== null;
  const isActive = !dissolved && (item.status ?? "").toLowerCase().startsWith("active");
  return (
    <Link
      href={`/companies/${item.enterprise_number}`}
      className="group flex flex-col gap-2 rounded-card border border-surface-line bg-surface p-4 shadow-card transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-card-lift"
    >
      <div className="flex items-start gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 transition group-hover:bg-brand-100">
          <Building2 className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-ink transition group-hover:text-brand-700">
            {item.name ?? (
              <em className="text-ink-muted">unnamed</em>
            )}
          </div>
          <div className="font-mono text-[11px] text-ink-muted">
            {item.enterprise_number}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1 text-[11px]">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 font-semibold uppercase tracking-wider",
            dissolved
              ? "bg-rose-50 text-rose-700"
              : isActive
              ? "bg-accent-profit-50 text-accent-profit-700"
              : "bg-surface-sub text-ink-subtle"
          )}
        >
          {dissolved ? "Dissolved" : item.status ?? "—"}
        </span>
        <span className="inline-flex items-center gap-1 text-ink-muted">
          <FileText className="h-3 w-3" />
          {item.statement_count}
        </span>
      </div>

      <div className="text-[11px] text-ink-muted">
        {formatRelative(item.last_refreshed_at)}
      </div>
    </Link>
  );
}

function LoadingGrid() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: LIMIT }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-card border border-surface-line bg-surface p-4 shadow-card"
        >
          <div className="flex items-start gap-2.5">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-card border border-dashed border-surface-line bg-surface px-6 py-10 text-center">
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-600">
        <Sparkles className="h-5 w-5" />
      </div>
      <p className="text-sm font-semibold text-ink">No companies cached yet</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-ink-muted">
        Run your first enrichment to start populating the cache. Each company
        you look up will appear here for one-click re-open.
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <Link
          href="/search"
          className="inline-flex items-center rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:bg-brand-600"
        >
          Search a company
        </Link>
        <Link
          href="/bulk"
          className="inline-flex items-center rounded-full border border-surface-line bg-surface px-4 py-2 text-sm font-semibold text-ink-subtle transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
        >
          Bulk enrich
        </Link>
      </div>
    </div>
  );
}

function Notice({ tone, body }: { tone: "warn" | "error"; body: string }) {
  const palette =
    tone === "warn"
      ? "bg-amber-50 text-amber-900 ring-amber-200"
      : "bg-rose-50 text-rose-900 ring-rose-200";
  return (
    <div className={`rounded-card px-5 py-4 text-sm shadow-card ring-1 ${palette}`}>
      {body}
    </div>
  );
}

function formatRelative(iso: string | null): string {
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
  return date.toLocaleDateString();
}
