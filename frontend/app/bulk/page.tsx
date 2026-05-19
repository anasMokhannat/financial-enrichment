"use client";

import {
  AlertCircle,
  CheckCircle2,
  ClipboardPaste,
  HelpCircle,
  Layers,
  Loader2,
  RotateCcw,
  Sparkles,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";

import { QueryChipsInput } from "@/components/QueryChipsInput";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { BulkSearchResponse, BulkSearchResult } from "@/lib/types";

const MAX_QUERIES = 100;

export default function BulkPage() {
  const [queries, setQueries] = useState<string[]>([]);
  const [refresh, setRefresh] = useState(false);
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "done"; response: BulkSearchResponse }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const tooMany = queries.length > MAX_QUERIES;
  const canSubmit = queries.length > 0 && !tooMany && state.kind !== "loading";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setState({ kind: "loading" });
    try {
      const response = await api.bulkSearch(queries, { refresh });
      setState({ kind: "done", response });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? `API ${err.status}`
          : err instanceof Error
          ? err.message
          : "Unknown error";
      setState({ kind: "error", message });
    }
  }

  async function pasteFromClipboard() {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      const clipboard = await navigator.clipboard.readText();
      const more = clipboard
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!more.length) return;
      // Dedupe against existing chips.
      const seen = new Set(queries.map((q) => q.toLowerCase()));
      const additions = more.filter((q) => {
        const k = q.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      setQueries([...queries, ...additions].slice(0, MAX_QUERIES));
    } catch {
      // permission denied — ignore silently
    }
  }

  function reset() {
    setQueries([]);
    setState({ kind: "idle" });
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <Header />

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 rounded-card bg-surface p-6 shadow-card ring-1 ring-surface-line"
      >
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-ink">Queries</div>
            <p className="mt-0.5 text-[11px] text-ink-muted">
              Each entry is a name or 10-digit CBE. Names get a cyan chip,
              numbers get a blue monospaced chip.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <QueryCount count={queries.length} tooMany={tooMany} />
            <button
              type="button"
              onClick={pasteFromClipboard}
              className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink-subtle shadow-card ring-1 ring-surface-line transition hover:bg-brand-50 hover:text-brand-700"
              title="Paste from clipboard"
            >
              <ClipboardPaste className="h-3 w-3" />
              Paste
            </button>
          </div>
        </div>

        <QueryChipsInput
          value={queries}
          onChange={setQueries}
          maxItems={MAX_QUERIES}
          placeholder="Type a name or CBE and press Enter — or paste a list…"
        />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-line pt-3">
          <div className="flex items-center gap-2 text-xs text-ink-subtle">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={refresh}
                onChange={(e) => setRefresh(e.target.checked)}
                className="h-4 w-4 rounded border-surface-line text-brand-500 focus:ring-brand-300"
              />
              Bypass cache (re-run the pipeline)
            </label>
            <span className="ml-1 inline-flex items-center text-ink-muted" title={
              "Without this flag, queries that hit Supabase return instantly. " +
              "With it, every query is re-fetched from KBO + NBB."
            }>
              <HelpCircle className="h-3 w-3" />
            </span>
          </div>

          <div className="flex items-center gap-2">
            {state.kind !== "idle" && (
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1.5 rounded-full border border-surface-line bg-surface px-4 py-2 text-sm font-semibold text-ink-subtle transition hover:bg-surface-sub"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Clear
              </button>
            )}
            <button
              type="submit"
              disabled={!canSubmit}
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold text-white shadow-card transition",
                canSubmit
                  ? "bg-brand-500 hover:bg-brand-600"
                  : "cursor-not-allowed bg-brand-200"
              )}
            >
              {state.kind === "loading" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {state.kind === "loading" ? "Running…" : "Run enrichment"}
            </button>
          </div>
        </div>
      </form>

      {state.kind === "error" && (
        <div className="flex items-start gap-3 rounded-card bg-rose-50 px-5 py-4 text-rose-900 shadow-card ring-1 ring-rose-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="text-sm font-semibold">Bulk request failed</div>
            <p className="mt-0.5 text-xs">{state.message}</p>
          </div>
        </div>
      )}

      {state.kind === "done" && <Results response={state.response} />}
    </div>
  );
}

function Header() {
  return (
    <header>
      <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-ink-muted">
        <Layers className="h-3.5 w-3.5" />
        Bulk enrichment
      </div>
      <h1 className="text-2xl font-bold text-ink">
        Process many companies at once
      </h1>
      <p className="mt-1 text-sm text-ink-subtle">
        Paste up to {MAX_QUERIES} names or enterprise numbers. Each
        query runs independently — a failure on one doesn&apos;t block
        the rest, and cached companies come back instantly.
      </p>
    </header>
  );
}

function QueryCount({ count, tooMany }: { count: number; tooMany: boolean }) {
  if (count === 0) {
    return (
      <span className="text-xs text-ink-muted">
        Start typing or paste a list
      </span>
    );
  }
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        tooMany
          ? "bg-rose-50 text-rose-700"
          : "bg-brand-50 text-brand-700"
      )}
    >
      {count} {count === 1 ? "query" : "queries"}
      {tooMany ? ` · max ${MAX_QUERIES}` : ""}
    </span>
  );
}

// ── Results ───────────────────────────────────────────────────────────

function Results({ response }: { response: BulkSearchResponse }) {
  const counts = response.results.reduce<Record<string, number>>(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {}
  );

  return (
    <section className="flex flex-col gap-4">
      <SummaryCards
        total={response.results.length}
        counts={counts}
        elapsedMs={response.elapsed_ms}
      />
      <ResultsTable rows={response.results} />
    </section>
  );
}

function SummaryCards({
  total,
  counts,
  elapsedMs,
}: {
  total: number;
  counts: Record<string, number>;
  elapsedMs: number;
}) {
  const cards = [
    {
      label: "Resolved",
      value: counts.ok ?? 0,
      tone: "ok" as const,
      icon: CheckCircle2,
    },
    {
      label: "Ambiguous",
      value: counts.ambiguous ?? 0,
      tone: "warn" as const,
      icon: HelpCircle,
    },
    {
      label: "Not found",
      value: counts.not_found ?? 0,
      tone: "warn" as const,
      icon: AlertCircle,
    },
    {
      label: "Errors",
      value: counts.error ?? 0,
      tone: "error" as const,
      icon: XCircle,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map((c) => (
        <SummaryCard
          key={c.label}
          label={c.label}
          value={c.value}
          tone={c.tone}
          Icon={c.icon}
        />
      ))}
      <div className="col-span-2 flex items-center justify-between gap-3 rounded-card bg-surface-sub px-4 py-3 text-xs text-ink-subtle md:col-span-4">
        <span>
          Finished {total} {total === 1 ? "query" : "queries"} in{" "}
          <span className="font-semibold text-ink">
            {(elapsedMs / 1000).toFixed(2)}s
          </span>
        </span>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
  Icon,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "error";
  Icon: React.ElementType;
}) {
  const palette =
    tone === "ok"
      ? { bg: "bg-emerald-50", fg: "text-emerald-700", edge: "bg-emerald-500", value: "text-emerald-700" }
      : tone === "error"
      ? { bg: "bg-rose-50", fg: "text-rose-700", edge: "bg-rose-500", value: "text-rose-700" }
      : { bg: "bg-amber-50", fg: "text-amber-700", edge: "bg-amber-500", value: "text-amber-700" };
  const dim = value === 0;
  return (
    <div className="relative overflow-hidden rounded-card bg-surface p-4 shadow-card ring-1 ring-surface-line">
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          dim ? "bg-surface-line" : palette.edge
        )}
      />
      <div className="flex items-center justify-between">
        <div
          className={cn(
            "grid h-8 w-8 place-items-center rounded-lg",
            dim ? "bg-surface-sub" : palette.bg
          )}
        >
          <Icon className={cn("h-4 w-4", dim ? "text-ink-muted" : palette.fg)} />
        </div>
        <span className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
          {label}
        </span>
      </div>
      <div
        className={cn(
          "mt-2 text-2xl font-bold tabular-nums",
          dim ? "text-ink-muted" : palette.value
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ResultsTable({ rows }: { rows: BulkSearchResult[] }) {
  return (
    <div className="overflow-hidden rounded-card border border-surface-line bg-surface shadow-card">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-surface-sub text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
          <tr>
            <th className="w-1 px-4 py-3"></th>
            <th className="px-4 py-3 text-left">Query</th>
            <th className="px-4 py-3 text-left">Resolved to</th>
            <th className="px-4 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-line">
          {rows.map((row, i) => (
            <BulkRow key={`${row.query}-${i}`} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BulkRow({ row }: { row: BulkSearchResult }) {
  return (
    <tr className="hover:bg-surface-sub/60">
      <td className="px-4 py-3">
        <StatusIcon status={row.status} />
      </td>
      <td className="px-4 py-3">
        <div className="truncate font-medium text-ink">{row.query}</div>
        {row.from_cache && row.status === "ok" && (
          <span className="mt-0.5 inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
            cache
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <RowDetail row={row} />
      </td>
      <td className="px-4 py-3 text-right">
        <RowAction row={row} />
      </td>
    </tr>
  );
}

function StatusIcon({ status }: { status: BulkSearchResult["status"] }) {
  switch (status) {
    case "ok":
      return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
    case "ambiguous":
      return <HelpCircle className="h-5 w-5 text-amber-500" />;
    case "not_found":
      return <AlertCircle className="h-5 w-5 text-amber-500" />;
    case "error":
      return <XCircle className="h-5 w-5 text-rose-500" />;
  }
}

function RowDetail({ row }: { row: BulkSearchResult }) {
  if (row.status === "ok" && row.report) {
    return (
      <div>
        <div className="font-medium text-ink">
          {row.report.company.name ?? "—"}
        </div>
        <div className="font-mono text-xs text-ink-muted">
          {row.report.company.enterprise_number}
        </div>
      </div>
    );
  }
  if (row.status === "ambiguous") {
    return (
      <span className="text-xs text-ink-subtle">
        {row.candidates?.length ?? 0} possible matches
      </span>
    );
  }
  if (row.error) {
    return <span className="text-xs text-rose-700">{row.error}</span>;
  }
  return <span className="text-xs text-ink-muted">—</span>;
}

function RowAction({ row }: { row: BulkSearchResult }) {
  if (row.status === "ok" && row.report) {
    return (
      <Link
        href={`/companies/${row.report.company.enterprise_number}`}
        className="inline-flex items-center text-sm font-semibold text-brand-700 hover:text-brand-800"
      >
        Open →
      </Link>
    );
  }
  if (row.status === "ambiguous" && row.candidates?.length) {
    return (
      <details className="inline-block">
        <summary className="cursor-pointer text-sm font-semibold text-brand-700 hover:text-brand-800">
          Pick →
        </summary>
        <ul className="absolute right-4 z-10 mt-2 max-h-72 w-80 space-y-1 overflow-auto rounded-lg border border-surface-line bg-surface p-2 shadow-card">
          {row.candidates.map((c) => (
            <li key={c.enterprise_number}>
              <Link
                href={`/companies/${c.enterprise_number}`}
                className="block rounded px-2 py-1.5 text-left text-xs text-ink-subtle hover:bg-brand-50 hover:text-brand-700"
              >
                <span className="font-mono">{c.enterprise_number}</span>{" "}
                <span className="font-medium">{c.name}</span>
                {c.address && (
                  <span className="block text-[10px] text-ink-muted">
                    {c.address}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </details>
    );
  }
  return null;
}
