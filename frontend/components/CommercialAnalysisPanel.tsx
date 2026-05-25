"use client";

import {
  AlertCircle,
  AlertTriangle,
  Check,
  Copy,
  Loader2,
  Mail,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useEffect, useState } from "react";

import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { CommercialAnalysis, Verdict } from "@/lib/types";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "loaded"; analysis: CommercialAnalysis }
  | { kind: "error"; message: string };

/**
 * AI-generated commercial-fit assessment for a company. Shows a
 * verdict badge, an executive summary, strength + concern lists, and
 * a concrete commercial recommendation. Cached server-side; a
 * regenerate button re-runs the analyzer.
 */
export function CommercialAnalysisPanel({ cbe }: { cbe: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState({ kind: "loading" });
      try {
        const analysis = await api.getAnalysis(cbe);
        if (!cancelled) setState({ kind: "loaded", analysis: analysis });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setState({ kind: "missing" });
        } else {
          const msg = err instanceof Error ? err.message : "Unknown error";
          setState({ kind: "error", message: msg });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cbe]);

  async function generate() {
    setState({ kind: "loading" });
    try {
      const analysis = await api.generateAnalysis(cbe);
      setState({ kind: "loaded", analysis: analysis });
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `API ${err.status}: ${
              typeof err.body === "object" &&
              err.body &&
              "detail" in (err.body as Record<string, unknown>)
                ? String((err.body as { detail: unknown }).detail)
                : err.message
            }`
          : err instanceof Error
          ? err.message
          : "Unknown error";
      setState({ kind: "error", message: msg });
    }
  }

  if (state.kind === "idle" || state.kind === "loading") {
    return (
      <Card>
        <div className="flex items-center gap-3 text-sm text-ink-subtle">
          <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
          {state.kind === "loading"
            ? "Loading commercial assessment…"
            : "Preparing…"}
        </div>
      </Card>
    );
  }

  if (state.kind === "missing") {
    return (
      <Card>
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-ink">
              No commercial assessment yet
            </h3>
            <p className="mt-1 text-sm text-ink-subtle">
              Run the AI analyzer to summarise this company&apos;s financial
              health and get a credit-posture recommendation.
            </p>
          </div>
          <GenerateButton onClick={generate} label="Generate" />
        </div>
      </Card>
    );
  }

  if (state.kind === "error") {
    return (
      <Card>
        <div className="flex items-start gap-3 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <div className="font-semibold">Analyzer failed</div>
            <p className="mt-0.5 text-xs">{state.message}</p>
          </div>
          <GenerateButton onClick={generate} label="Retry" />
        </div>
      </Card>
    );
  }

  return <LoadedAnalysis analysis={state.analysis} onRegenerate={generate} />;
}

function LoadedAnalysis({
  analysis,
  onRegenerate,
}: {
  analysis: CommercialAnalysis;
  onRegenerate: () => void;
}) {
  return (
    <Card>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <VerdictBadge verdict={analysis.verdict} />
          <div>
            <h3 className="text-base font-semibold text-ink">
              Commercial assessment
            </h3>
            <p className="mt-0.5 text-xs text-ink-muted">
              AI-generated
              {analysis.generated_at && (
                <span className="ml-1">
                  · {new Date(analysis.generated_at).toLocaleString()}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ConfidenceGauge
            score={analysis.confidence_score}
            label={analysis.confidence}
          />
          <GenerateButton onClick={onRegenerate} label="Regenerate" />
        </div>
      </header>

      <p className="mt-4 text-sm leading-relaxed text-ink">
        {analysis.summary}
      </p>

      {analysis.confidence_factors.length > 0 && (
        <details className="mt-3 rounded-lg bg-surface-sub/70 px-3 py-2 text-xs text-ink-subtle ring-1 ring-surface-line">
          <summary className="cursor-pointer font-medium text-ink">
            Why this confidence?
          </summary>
          <ul className="mt-2 space-y-1 pl-1">
            {analysis.confidence_factors.map((reason, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-muted" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Column
          title="Strengths"
          tone="ok"
          icon={TrendingUp}
          items={analysis.strengths}
        />
        <Column
          title="Concerns"
          tone="warn"
          icon={TrendingDown}
          items={analysis.concerns}
        />
      </div>

      <div className="mt-5 rounded-xl bg-brand-50/70 px-4 py-3 ring-1 ring-brand-100">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-brand-700">
          Recommendation
        </div>
        <p className="mt-1 text-sm text-ink">
          {analysis.commercial_recommendation}
        </p>
      </div>

      <OutreachSection
        summary={analysis.outreach_summary}
        angles={analysis.outreach_email_angles}
      />

      <footer className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted">
        <span>
          Based on {analysis.based_on_filing_refs.length} filing
          {analysis.based_on_filing_refs.length === 1 ? "" : "s"}
        </span>
        {analysis.model && <span>· model: {analysis.model}</span>}
      </footer>
    </Card>
  );
}

/**
 * Donut-style numeric confidence gauge. Renders as an SVG ring whose
 * arc fills 0-360° based on the score. Color tracks the categorical
 * confidence so a glance answers "is this trustworthy?" — emerald for
 * high (≥70), amber for medium (40-69), rose for low (<40).
 *
 * Falls back to a small chip showing just the categorical label when
 * the numeric score is absent (legacy rows generated before the
 * column existed).
 */
function ConfidenceGauge({
  score,
  label,
}: {
  score: number | null;
  label: "high" | "medium" | "low";
}) {
  // Legacy row, no numeric score available.
  if (score === null || score === undefined) {
    const palette = CONFIDENCE_PALETTE[label];
    return (
      <span
        className={cn(
          "rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider",
          palette.bg,
          palette.fg
        )}
        title={`Confidence: ${label}`}
      >
        {label}
      </span>
    );
  }

  const palette = CONFIDENCE_PALETTE[label];
  const clamped = Math.max(0, Math.min(100, score));
  // SVG ring math: r=18 → circumference = 2 * pi * 18 ≈ 113.1
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const dash = (clamped / 100) * circumference;
  return (
    <div
      className="flex items-center gap-2.5"
      title={`AI confidence: ${clamped}/100 (${label})`}
    >
      <div className="relative h-12 w-12">
        <svg viewBox="0 0 44 44" className="h-12 w-12 -rotate-90">
          {/* Track */}
          <circle
            cx="22"
            cy="22"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            className="text-surface-line"
          />
          {/* Filled arc */}
          <circle
            cx="22"
            cy="22"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            className={cn("transition-all duration-500", palette.ring)}
          />
        </svg>
        <span className="absolute inset-0 grid place-items-center text-[11px] font-bold text-ink">
          {clamped}
        </span>
      </div>
      <div className="text-[11px] leading-tight">
        <div className="font-semibold text-ink">Confidence</div>
        <div
          className={cn(
            "font-semibold uppercase tracking-wider",
            palette.fg
          )}
        >
          {label}
        </div>
      </div>
    </div>
  );
}

const CONFIDENCE_PALETTE: Record<
  "high" | "medium" | "low",
  { bg: string; fg: string; ring: string }
> = {
  high: {
    bg: "bg-accent-profit-50",
    fg: "text-accent-profit-700",
    ring: "text-accent-profit-600",
  },
  medium: {
    bg: "bg-amber-50",
    fg: "text-amber-700",
    ring: "text-amber-500",
  },
  low: {
    bg: "bg-rose-50",
    fg: "text-rose-700",
    ring: "text-rose-500",
  },
};

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const meta = VERDICT_META[verdict];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
        meta.bg
      )}
      title={`Verdict: ${meta.label}`}
    >
      <Icon className={cn("h-5 w-5", meta.fg)} />
      <span className="sr-only">{meta.label}</span>
    </span>
  );
}

const VERDICT_META: Record<
  Verdict,
  { label: string; bg: string; fg: string; icon: React.ElementType }
> = {
  strong: {
    label: "Strong",
    bg: "bg-emerald-100",
    fg: "text-emerald-700",
    icon: ShieldCheck,
  },
  stable: {
    label: "Stable",
    bg: "bg-brand-100",
    fg: "text-brand-700",
    icon: Shield,
  },
  watch: {
    label: "Watch",
    bg: "bg-amber-100",
    fg: "text-amber-700",
    icon: AlertTriangle,
  },
  risky: {
    label: "Risky",
    bg: "bg-orange-100",
    fg: "text-orange-700",
    icon: ShieldAlert,
  },
  avoid: {
    label: "Avoid",
    bg: "bg-rose-100",
    fg: "text-rose-700",
    icon: ShieldX,
  },
};

/**
 * Email-outreach helper rendered under the Recommendation block.
 *
 * Skipped silently when both fields are empty — happens for legacy
 * analyses generated before this section existed, and for "avoid"
 * verdicts where the model is told to leave the angles empty.
 */
function OutreachSection({
  summary,
  angles,
}: {
  summary: string;
  angles: string[];
}) {
  if (!summary && angles.length === 0) return null;

  return (
    <div className="mt-5 rounded-xl border border-brand-100 bg-surface px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-brand-700">
          <Mail className="h-3.5 w-3.5" />
        </span>
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-ink">
          Email outreach
        </h4>
      </div>

      {summary && (
        <p className="mt-2 text-sm leading-relaxed text-ink-subtle">
          {summary}
        </p>
      )}

      {angles.length > 0 && (
        <ul className="mt-3 space-y-2">
          {angles.map((angle, i) => (
            <OutreachAngle key={i} text={angle} />
          ))}
        </ul>
      )}
    </div>
  );
}

function OutreachAngle({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be blocked in some browser contexts; ignore.
    }
  }

  return (
    <li className="group flex items-start gap-2 rounded-lg bg-surface-sub/60 px-3 py-2 text-sm text-ink">
      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-500" />
      <span className="flex-1">{text}</span>
      <button
        type="button"
        onClick={copy}
        className={cn(
          "shrink-0 rounded-md p-1 text-ink-muted ring-1 transition hover:text-ink",
          copied
            ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
            : "ring-transparent group-hover:ring-surface-line",
        )}
        title={copied ? "Copied" : "Copy to clipboard"}
        aria-label={copied ? "Copied" : "Copy email hook"}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </li>
  );
}

function Column({
  title,
  tone,
  icon: Icon,
  items,
}: {
  title: string;
  tone: "ok" | "warn";
  icon: React.ElementType;
  items: string[];
}) {
  const palette =
    tone === "ok"
      ? { iconBg: "bg-emerald-50", iconFg: "text-emerald-600", bullet: "text-emerald-500" }
      : { iconBg: "bg-amber-50", iconFg: "text-amber-700", bullet: "text-amber-500" };
  return (
    <div className="rounded-xl border border-surface-line bg-surface-sub/40 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span
          className={cn(
            "grid h-7 w-7 place-items-center rounded-lg",
            palette.iconBg
          )}
        >
          <Icon className={cn("h-3.5 w-3.5", palette.iconFg)} />
        </span>
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-ink">
          {title}
        </h4>
      </div>
      {items.length === 0 ? (
        <p className="text-xs italic text-ink-muted">No items reported.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-ink">
              <span className={cn("mt-1.5 h-1 w-1 shrink-0 rounded-full", palette.bullet)}>
                <span className="sr-only">·</span>
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GenerateButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-brand-600"
    >
      <Sparkles className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-surface-line bg-surface px-5 py-4">
      {children}
    </section>
  );
}
