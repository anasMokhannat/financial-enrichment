"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  ChevronRight,
  Loader2,
  Network,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import type { GroupNode, GroupResponse } from "@/lib/types";

type State =
  | { kind: "loading" }
  | { kind: "ready"; data: GroupResponse }
  | { kind: "error"; message: string }
  | { kind: "unavailable" };

/**
 * Renders the one-hop corporate-group graph for a company: parents
 * (who directs us) above, subsidiaries (who we direct) below.
 *
 * The graph is built purely from the Supabase cache — no scraping
 * happens here. Nodes we haven't enriched yet are display-only; nodes
 * we have are clickable links to their detail page.
 */
export function GroupStructure({ cbe }: { cbe: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`/api/companies/${cbe}/group`, {
          cache: "no-store",
        });
        if (resp.status === 503) {
          if (!cancelled) setState({ kind: "unavailable" });
          return;
        }
        const body = await resp.json();
        if (!resp.ok) {
          const detail =
            body && typeof body === "object" && "detail" in body
              ? String((body as { detail: unknown }).detail)
              : `Group lookup failed (HTTP ${resp.status})`;
          if (!cancelled) setState({ kind: "error", message: detail });
          return;
        }
        if (!cancelled)
          setState({ kind: "ready", data: body as GroupResponse });
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Network error";
        setState({ kind: "error", message: msg });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cbe]);

  return (
    <section className="rounded-card border border-surface-line bg-surface px-5 py-4">
      <header className="mb-3 flex items-center gap-2 text-ink">
        <Network className="h-4 w-4 text-ink-muted" />
        <h2 className="text-sm font-semibold">Group structure</h2>
      </header>

      {state.kind === "loading" && (
        <div className="flex items-center gap-2 text-sm text-ink-subtle">
          <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
          Loading group graph…
        </div>
      )}

      {state.kind === "unavailable" && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          Supabase not configured — group structure is unavailable.
        </p>
      )}

      {state.kind === "error" && (
        <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-900 ring-1 ring-rose-200">
          {state.message}
        </p>
      )}

      {state.kind === "ready" && <Graph data={state.data} />}
    </section>
  );
}

function Graph({ data }: { data: GroupResponse }) {
  const hasParents = data.parents.length > 0;
  const hasSubs = data.subsidiaries.length > 0;

  if (!hasParents && !hasSubs) {
    return (
      <p className="rounded-lg bg-surface-sub px-4 py-3 text-sm text-ink-muted">
        No corporate parents or subsidiaries on file for this company.
        Either it&apos;s an independent entity or none of its related
        companies have been enriched yet — open a related CBE through
        Search to build out the graph.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Direction
        title="Parents"
        caption="Companies that sit on this company's board (they direct us)"
        icon={ArrowUpRight}
        tone="up"
        nodes={data.parents}
      />
      <SelfRow
        cbe={data.self.enterprise_number}
        name={data.self.name}
      />
      <Direction
        title="Subsidiaries"
        caption="Companies this company directs (we sit on their board)"
        icon={ArrowDownRight}
        tone="down"
        nodes={data.subsidiaries}
      />
    </div>
  );
}

function Direction({
  title,
  caption,
  icon: Icon,
  tone,
  nodes,
}: {
  title: string;
  caption: string;
  icon: React.ElementType;
  tone: "up" | "down";
  nodes: GroupNode[];
}) {
  const palette =
    tone === "up"
      ? { iconBg: "bg-indigo-50", iconFg: "text-indigo-700", chip: "bg-indigo-50 text-indigo-700" }
      : { iconBg: "bg-emerald-50", iconFg: "text-emerald-700", chip: "bg-emerald-50 text-emerald-700" };

  return (
    <div>
      <header className="mb-2 flex items-center gap-2">
        <span className={cn("grid h-7 w-7 place-items-center rounded-lg", palette.iconBg)}>
          <Icon className={cn("h-3.5 w-3.5", palette.iconFg)} />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <p className="text-[11px] text-ink-muted">{caption}</p>
        </div>
        <span
          className={cn(
            "ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
            palette.chip,
          )}
        >
          {nodes.length}
        </span>
      </header>

      {nodes.length === 0 ? (
        <p className="rounded-lg bg-surface-sub px-3 py-2 text-xs italic text-ink-muted">
          None found in the cache.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-2 xl:grid-cols-3">
          {nodes.map((n, i) => (
            <li key={`${n.enterprise_number}-${n.role}-${i}`}>
              <NodeCard node={n} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NodeCard({ node }: { node: GroupNode }) {
  const body = (
    <div className="flex items-center gap-2 rounded-lg border border-surface-line bg-surface-sub/40 px-2.5 py-1.5 transition group-hover:border-brand-200 group-hover:bg-surface">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand-100 text-brand-700">
        <Building2 className="h-3 w-3" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-ink">
          {node.name ?? <em className="font-normal text-ink-muted">unnamed</em>}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-ink-muted">
          <span className="font-mono">{node.enterprise_number}</span>
          {node.role && (
            <>
              <span>·</span>
              <span className="truncate">{node.role}</span>
            </>
          )}
        </div>
        {node.since && (
          <div className="text-[10px] text-ink-muted">since {node.since}</div>
        )}
      </div>
      {node.in_cache ? (
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-muted transition group-hover:text-brand-600" />
      ) : (
        <span
          className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700"
          title="This company has not been enriched yet. Open it via Search to add it to the graph."
        >
          New
        </span>
      )}
    </div>
  );

  if (node.in_cache) {
    return (
      <Link
        href={`/companies/${node.enterprise_number}`}
        className="group block"
      >
        {body}
      </Link>
    );
  }
  return <div className="group block">{body}</div>;
}

function SelfRow({ cbe, name }: { cbe: string; name: string | null }) {
  return (
    <div className="flex items-center gap-3 self-center rounded-xl bg-brand-500 px-4 py-2 text-white shadow-card">
      <Building2 className="h-4 w-4" />
      <div>
        <div className="text-sm font-semibold">
          {name ?? `CBE ${cbe}`}
        </div>
        <div className="font-mono text-[11px] text-white/80">{cbe}</div>
      </div>
    </div>
  );
}
