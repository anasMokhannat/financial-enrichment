"use client";

import {
  AlertCircle,
  CheckCircle2,
  Clock,
  HelpCircle,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/cn";
import {
  clearRecents,
  removeRecent,
  type RecentSearch,
  type RecentSearchStatus,
} from "@/lib/recentSearches";

type Props = {
  items: RecentSearch[];
  onChange: (items: RecentSearch[]) => void;
  /** Called when the user clicks a query that didn't resolve to a single CBE. */
  onPick: (query: string) => void;
};

/**
 * Recent searches list. Items resolved to a single CBE link straight
 * to /companies/{cbe} (fastest path). Anything else (ambiguous /
 * not_found / error) re-runs the query through the search box via
 * the parent's `onPick`.
 *
 * Storage is local to this browser (see lib/recentSearches.ts).
 */
export function RecentSearches({ items, onChange, onPick }: Props) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No recent searches yet. Run one above — it&apos;ll show up here.
      </p>
    );
  }

  return (
    <div className="rounded-card bg-surface shadow-card ring-1 ring-surface-line">
      <header className="flex items-center justify-between border-b border-surface-line px-5 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Clock className="h-4 w-4 text-ink-muted" />
          Recent searches
        </div>
        <button
          onClick={() => {
            clearRecents();
            onChange([]);
          }}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-muted transition hover:bg-rose-50 hover:text-rose-700"
        >
          <Trash2 className="h-3 w-3" />
          Clear
        </button>
      </header>

      <ul className="divide-y divide-surface-line">
        {items.map((entry) => (
          <Row
            key={entry.query + entry.searched_at}
            entry={entry}
            onPick={onPick}
            onRemove={() => {
              const next = removeRecent(entry.query);
              onChange(next);
            }}
          />
        ))}
      </ul>
    </div>
  );
}

function Row({
  entry,
  onPick,
  onRemove,
}: {
  entry: RecentSearch;
  onPick: (query: string) => void;
  onRemove: () => void;
}) {
  const stamp = formatRelative(entry.searched_at);
  const Icon = ICONS[entry.status];
  const tone = TONES[entry.status];

  return (
    <li className="group flex items-center gap-3 px-5 py-3 transition hover:bg-brand-50/50">
      <span className={cn("grid h-7 w-7 place-items-center rounded-lg", tone.bg)}>
        <Icon className={cn("h-3.5 w-3.5", tone.fg)} />
      </span>

      <div className="min-w-0 flex-1">
        {entry.status === "ok" && entry.enterprise_number ? (
          <Link
            href={`/companies/${entry.enterprise_number}`}
            className="block font-medium text-ink hover:text-brand-700"
          >
            {entry.query}
            {entry.resolved_name &&
              entry.resolved_name.toLowerCase() !==
                entry.query.toLowerCase() && (
                <span className="ml-2 text-xs font-normal text-ink-muted">
                  → {entry.resolved_name}
                </span>
              )}
          </Link>
        ) : (
          <button
            onClick={() => onPick(entry.query)}
            className="block w-full text-left font-medium text-ink hover:text-brand-700"
          >
            {entry.query}
          </button>
        )}
        <div className="mt-0.5 text-[11px] text-ink-muted">
          {STATUS_LABEL[entry.status]}
          {entry.enterprise_number && (
            <span className="ml-2 font-mono">{entry.enterprise_number}</span>
          )}
          <span className="ml-2">· {stamp}</span>
        </div>
      </div>

      <button
        onClick={onRemove}
        aria-label={`Remove ${entry.query} from recent searches`}
        className="shrink-0 rounded-full p-1 text-ink-muted opacity-0 transition hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

const ICONS = {
  ok: CheckCircle2,
  ambiguous: HelpCircle,
  not_found: AlertCircle,
  error: XCircle,
} as const;

const TONES = {
  ok: { bg: "bg-emerald-50", fg: "text-emerald-600" },
  ambiguous: { bg: "bg-amber-50", fg: "text-amber-600" },
  not_found: { bg: "bg-amber-50", fg: "text-amber-600" },
  error: { bg: "bg-rose-50", fg: "text-rose-600" },
} as const;

const STATUS_LABEL: Record<RecentSearchStatus, string> = {
  ok: "Resolved",
  ambiguous: "Ambiguous",
  not_found: "Not found",
  error: "Error",
};

function formatRelative(iso: string): string {
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
