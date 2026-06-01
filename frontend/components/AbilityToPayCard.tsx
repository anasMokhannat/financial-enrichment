import {
  AlertOctagon,
  Gauge,
  ShieldCheck,
  ShieldX,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { cn } from "@/lib/cn";
import {
  scoreCompany,
  scoreInputsFromStatements,
  type AbilityToPayScore,
  type ComponentCode,
  type Tier,
} from "@/lib/scoring";
import type { CompanyFinancialReport } from "@/lib/types";

/**
 * Deterministic, rule-based ability-to-pay score for the company.
 *
 * Sibling to the AI-driven CommercialAnalysisPanel — that panel is
 * qualitative; this card is purely mechanical (no model, fully
 * explainable). They answer different questions:
 *   - Commercial assessment: "is this prospect worth a conversation?"
 *   - Ability to pay:        "can they actually afford and pay us?"
 *
 * Pure server component — the scoring runs at render time from the
 * statements already on the report, no API call.
 */
export function AbilityToPayCard({
  report,
}: {
  report: CompanyFinancialReport;
}) {
  const inputs = scoreInputsFromStatements(report.statements);
  const score = scoreCompany(inputs);

  return (
    <section className="rounded-card border border-surface-line bg-surface px-5 py-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-ink">
          <Gauge className="h-4 w-4 text-ink-muted" />
          <h2 className="text-sm font-semibold">Ability to pay</h2>
          <span className="text-xs text-ink-muted">
            · rule-based score, 0–100
          </span>
        </div>
        <TierBadge tier={score.tier} value={score.final_score} />
      </header>

      <p className="mt-3 text-sm leading-relaxed text-ink">
        {score.explanation}
      </p>

      {score.distress_flags.length > 0 && (
        <DistressList flags={score.distress_flags} />
      )}

      <details className="mt-3 rounded-lg border border-surface-line bg-surface-sub/40 px-3 py-2 text-xs text-ink-subtle">
        <summary className="cursor-pointer font-medium text-ink">
          Score breakdown
        </summary>
        <div className="mt-2 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="Base" value={score.base_score.toFixed(1)} />
            <MiniStat
              label="After modifiers"
              value={score.adjusted_score.toFixed(1)}
              delta={score.adjusted_score - score.base_score}
            />
            <MiniStat label="Final" value={`${score.final_score}/100`} />
          </div>
          <YearTable score={score} />
          <p className="leading-relaxed">
            Uses the <span className="font-medium">3 most recent</span>{" "}
            fiscal years. Each year scores 6 components on a 0–100 band
            scale, blended with a 0.5 / 0.3 / 0.2 recency weight. A ±10
            trajectory modifier and a 60-point volatility cap apply
            when the window has ≥2 years. Distress red flags (negative
            equity, D/E &gt; 4, cash burn &gt; revenue, …) cap the final
            score at 30 regardless.
          </p>
        </div>
      </details>
    </section>
  );
}

// ── components ─────────────────────────────────────────────────────────

const TIER_META: Record<
  Tier,
  { label: string; bg: string; fg: string; icon: React.ElementType }
> = {
  strong: {
    label: "Strong",
    bg: "bg-emerald-50",
    fg: "text-emerald-700",
    icon: ShieldCheck,
  },
  moderate: {
    label: "Moderate",
    bg: "bg-brand-50",
    fg: "text-brand-700",
    icon: Gauge,
  },
  weak: {
    label: "Weak",
    bg: "bg-amber-50",
    fg: "text-amber-700",
    icon: TrendingDown,
  },
  avoid: {
    label: "Avoid",
    bg: "bg-rose-50",
    fg: "text-rose-700",
    icon: ShieldX,
  },
};

function TierBadge({ tier, value }: { tier: Tier; value: number }) {
  const meta = TIER_META[tier];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium",
        meta.bg,
        meta.fg,
      )}
      title={`Tier: ${meta.label} (${value}/100)`}
    >
      <Icon className="h-3.5 w-3.5" />
      {meta.label} · {value}/100
    </span>
  );
}

function MiniStat({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: number;
}) {
  let deltaEl: React.ReactNode = null;
  if (delta !== undefined && Math.round(delta * 10) !== 0) {
    const positive = delta > 0;
    const Icon = positive ? TrendingUp : TrendingDown;
    deltaEl = (
      <span
        className={cn(
          "ml-1 inline-flex items-center gap-0.5 text-[9px] font-medium",
          positive ? "text-emerald-700" : "text-rose-700",
        )}
      >
        <Icon className="h-2.5 w-2.5" />
        {positive ? "+" : ""}
        {delta.toFixed(1)}
      </span>
    );
  }
  return (
    <div className="rounded border border-surface-line bg-surface px-2 py-1.5">
      <div className="text-[10px] text-ink-muted">{label}</div>
      <div className="mt-0.5 flex items-baseline">
        <span className="text-xs font-semibold text-ink">{value}</span>
        {deltaEl}
      </div>
    </div>
  );
}

const DISTRESS_LABELS: Record<string, string> = {
  negative_equity: "Negative equity",
  extreme_leverage: "Extreme leverage (D/E > 4)",
  illiquid_and_loss_making: "Illiquid & loss-making",
  cash_burn_exceeds_revenue: "Cash burn > revenue",
  consecutive_losses: "Consecutive net losses",
};

function DistressList({ flags }: { flags: string[] }) {
  return (
    <div className="mt-3 flex flex-wrap items-start gap-2 rounded-md bg-rose-50 px-3 py-2 ring-1 ring-rose-200">
      <AlertOctagon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-700" />
      <div className="flex flex-wrap gap-1.5">
        {flags.map((f) => (
          <span
            key={f}
            className="rounded bg-white px-2 py-0.5 text-[11px] font-medium text-rose-700 ring-1 ring-rose-200"
          >
            {DISTRESS_LABELS[f] ?? f}
          </span>
        ))}
      </div>
    </div>
  );
}

const COMPONENT_LABELS: Record<ComponentCode, string> = {
  L: "Liquidity",
  P: "Profitability",
  S: "Solvency",
  C: "Cash",
  R: "Revenue",
  T: "Trend",
};

function YearTable({ score }: { score: AbilityToPayScore }) {
  if (score.per_year.length === 0) return null;
  const componentCodes: ComponentCode[] = ["L", "P", "S", "C", "R", "T"];
  return (
    <div className="mt-4 overflow-x-auto rounded-md border border-surface-line">
      <table className="w-full text-left text-xs">
        <thead className="bg-surface-sub/60 text-[10px] uppercase tracking-wider text-ink-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Year</th>
            {componentCodes.map((c) => (
              <th key={c} className="px-2 py-2 text-right font-medium" title={COMPONENT_LABELS[c]}>
                {c}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-medium">Year score</th>
          </tr>
        </thead>
        <tbody className="text-ink">
          {score.per_year.map((y, i) => (
            <tr
              key={`${y.fiscal_year}-${i}`}
              className="border-t border-surface-line"
            >
              <td className="px-3 py-1.5 font-medium">
                {y.fiscal_year ?? "—"}
                {i === 0 && (
                  <span className="ml-1 rounded bg-brand-50 px-1 py-0.5 text-[9px] font-medium text-brand-700">
                    latest
                  </span>
                )}
              </td>
              {componentCodes.map((c) => (
                <td key={c} className="px-2 py-1.5 text-right tabular-nums">
                  <ComponentCell
                    value={y.components[c]}
                    weightForBar={c}
                  />
                </td>
              ))}
              <td className="px-3 py-1.5 text-right font-semibold tabular-nums">
                {y.year_score.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-surface-line bg-surface-sub/40 px-3 py-1.5 text-[10px] text-ink-muted">
        L = Liquidity · P = Profitability · S = Solvency · C = Cash · R = Revenue · T = Trend
      </div>
    </div>
  );
}

function ComponentCell({
  value,
  weightForBar: _code,
}: {
  value: number | null;
  weightForBar: ComponentCode;
}) {
  if (value === null) return <span className="text-ink-muted">—</span>;
  const tone =
    value >= 80
      ? "text-emerald-700"
      : value >= 50
      ? "text-ink"
      : "text-rose-700";
  return <span className={tone}>{value}</span>;
}
