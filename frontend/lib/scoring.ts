/**
 * Ability-to-pay lead-scoring engine.
 *
 * Deterministic, rule-based, no ML. Converts one or more fiscal years
 * of a company's financial metrics into a single 0-100 priority score
 * focused on whether the company can actually afford and pay for our
 * product over the life of a contract.
 *
 * The score is fully explainable: every component, weight, modifier
 * and override is exposed on the returned object, plus a human-readable
 * `explanation` string for the sales UI.
 *
 * Pure module — no Supabase, no fetch, no React. Easy to unit-test.
 * Consumers convert their own data into `ScoreInput` and call
 * `scoreCompany(inputs)`. A convenience adapter `scoreInputsFromStatements`
 * is provided that wraps the existing FinancialStatement + computeRatios
 * pair so callers don't have to duplicate the math.
 */

import { computeRatios } from "./ratios";
import type { FinancialStatement } from "./types";

// ╔════════════════════════════════════════════════════════════════════╗
// ║  CONFIG — tune freely; logic below reads everything from here.    ║
// ╚════════════════════════════════════════════════════════════════════╝

/** Component code → weight in the per-year score. Must sum to 1. */
export const COMPONENT_WEIGHTS = {
  L: 0.25, // Liquidity
  P: 0.25, // Profitability
  S: 0.2, // Solvency
  C: 0.15, // Cash cushion
  R: 0.1, // Revenue scale
  T: 0.05, // Trend
} as const;

/** Profitability component source. OCF is harder to manipulate than
 *  net margin and a stronger ability-to-pay signal. Default is
 *  net_margin to match the spec's table; flip the toggle to upgrade. */
export type ProfitabilitySource = "net_margin" | "ocf_margin" | "blend";
export const PROFITABILITY_SOURCE: ProfitabilitySource = "net_margin";

/**
 * Band tables. Each entry: `[lower_inclusive_threshold, score]`,
 * read top-to-bottom. The matched band is the first whose threshold
 * the metric meets (≥). The last entry's threshold of -Infinity acts
 * as the catch-all. "Lower is better" metrics use an inverted table
 * (see SOLVENCY_BANDS).
 */
export const LIQUIDITY_BANDS: Array<[number, number]> = [
  [1.5, 100],
  [1.2, 80],
  [1.0, 50],
  [-Infinity, 20],
];

/** Net-margin bands (%). */
export const PROFITABILITY_BANDS: Array<[number, number]> = [
  [15, 100],
  [5, 80],
  [0, 50],
  [-Infinity, 20],
];

/** Debt-to-equity (lower is better) — uses an upper-bound table. The
 *  first entry whose threshold is ≥ d/e wins. */
export const SOLVENCY_BANDS_UPPER: Array<[number, number]> = [
  [0.5, 100],
  [1.5, 80],
  [3, 50],
  [Infinity, 20],
];

export const CASH_BANDS: Array<[number, number]> = [
  [1.0, 100],
  [0.5, 80],
  [0.2, 50],
  [-Infinity, 20],
];

/** Revenue scale (EUR). Tune to your ICP. */
export const REVENUE_BANDS: Array<[number, number]> = [
  [5_000_000, 100],
  [1_000_000, 80],
  [250_000, 50],
  [-Infinity, 20],
];

/** Trend thresholds (revenue_growth %). Three buckets: improving /
 *  flat / declining. */
export const TREND_THRESHOLDS = {
  improving_above_pct: 5, // > +5%   → 100
  declining_below_pct: -5, // < -5%  → 30
  // anything in between    → 70
} as const;

/** Recency weights for blending year scores. Latest first. */
export const RECENCY_3YR = [0.5, 0.3, 0.2] as const;
export const RECENCY_2YR = [0.6, 0.4] as const;

/**
 * Hard cap on how many fiscal years feed the scoring. Older history
 * is dropped before any component score is computed, so volatility,
 * trajectory, distress, structural-change, and the per-year breakdown
 * all see the same recent-N-years window.
 */
export const MAX_HISTORY_YEARS = 3;

/** Trajectory modifier — delta added/subtracted from `base_score`. */
export const TRAJECTORY_DETERIORATING_DELTA = -15; // trend ≤ -15 → minus
export const TRAJECTORY_IMPROVING_DELTA = 15; //      trend ≥ +15 → plus
export const TRAJECTORY_ADJUSTMENT = 10; //           magnitude applied

/** Volatility — if max-min of year scores exceeds this, cap final score. */
export const VOLATILITY_RANGE_THRESHOLD = 25;
export const VOLATILITY_CAP = 60;

/** Distress override thresholds. */
export const DISTRESS_D_TO_E = 4;
export const DISTRESS_FCF_ABS_OVER_REVENUE_RATIO = 1; // |FCF| > revenue
export const DISTRESS_CONSECUTIVE_LOSS_YEARS = 2;
export const DISTRESS_SCORE_CAP = 30;

/** Structural-change YoY ratio (50% = 0.5). */
export const STRUCTURAL_CHANGE_RATIO = 0.5;

/** Tier cutoffs. */
export const TIER_CUTOFFS = {
  strong: 75,
  moderate: 50,
  weak: 30,
} as const;

// ╔════════════════════════════════════════════════════════════════════╗
// ║  TYPES                                                             ║
// ╚════════════════════════════════════════════════════════════════════╝

export type Tier = "strong" | "moderate" | "weak" | "avoid";

/** A single fiscal year of metrics. Any field may be null when missing
 *  from the source filing — the scorer handles that gracefully. */
export type ScoreInput = {
  fiscal_year: number | null;
  revenue: number | null;
  net_profit: number | null;
  total_assets: number | null;
  equity: number | null;
  cash: number | null;
  employees: number | null;
  /** percentage units, e.g. -32.9 means -32.9% YoY */
  revenue_growth: number | null;
  operating_margin: number | null;
  net_margin: number | null;
  roe: number | null;
  operating_cash_flow: number | null;
  free_cash_flow: number | null;
  current_ratio: number | null;
  quick_ratio: number | null;
  cash_ratio: number | null;
  debt_to_equity: number | null;
  /** percentage units */
  equity_ratio: number | null;
};

export type ComponentCode = keyof typeof COMPONENT_WEIGHTS;

export type YearBreakdown = {
  fiscal_year: number | null;
  components: Record<ComponentCode, number | null>;
  year_score: number;
  /** Component codes that were missing input data and excluded from
   *  the weighted sum (other weights renormalised). */
  missing: ComponentCode[];
};

export type DistressFlag =
  | "negative_equity"
  | "extreme_leverage"
  | "illiquid_and_loss_making"
  | "cash_burn_exceeds_revenue"
  | "consecutive_losses";

export type AbilityToPayScore = {
  /** Final 0-100 priority score after all modifiers + overrides. */
  final_score: number;
  tier: Tier;
  /** Recency-weighted blend of year scores, before modifiers. */
  base_score: number;
  /** After trajectory + volatility, before distress override. */
  adjusted_score: number;
  /** Weights used to blend the years, latest first. */
  recency_weights: number[];
  /** Newest first. */
  per_year: YearBreakdown[];
  /** Distress red flags that fired. */
  distress_flags: DistressFlag[];
  /** True iff the distress override capped the score. */
  override_capped: boolean;
  flags: {
    limited_history: boolean;
    volatile: boolean;
    structural_change: boolean;
    /** True when any component on the latest year was missing data. */
    low_confidence: boolean;
  };
  /** Human-readable summary for the sales UI. */
  explanation: string;
};

// ╔════════════════════════════════════════════════════════════════════╗
// ║  ADAPTER — turn FinancialStatement[] into ScoreInput[]            ║
// ╚════════════════════════════════════════════════════════════════════╝

/**
 * Convert the platform's stored FinancialStatement rows into the
 * ScoreInput shape this module wants. Reuses `computeRatios` so we
 * don't duplicate the ratio math. Returns newest-first.
 */
export function scoreInputsFromStatements(
  statements: FinancialStatement[],
): ScoreInput[] {
  const sorted = [...statements].sort(
    (a, b) => (b.fiscal_year ?? 0) - (a.fiscal_year ?? 0),
  );
  const inputs: ScoreInput[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    // `prev` (older year) is needed by computeRatios for revenue_growth,
    // FCF. Pass the next-newer-down-the-list entry, i.e. the year before.
    const prev = sorted[i + 1] ?? null;
    const r = computeRatios(s, prev);
    inputs.push({
      fiscal_year: s.fiscal_year,
      revenue: numOrNull(s.revenue),
      net_profit: numOrNull(s.net_profit),
      total_assets: numOrNull(s.total_assets),
      equity: numOrNull(s.total_equity),
      cash: numOrNull(s.cash_and_equivalents),
      employees: numOrNull(s.employees_fte),
      // computeRatios returns growth/margins as DECIMAL fractions
      // (e.g. -0.329 = -32.9%). Spec wants percentages; multiply.
      revenue_growth: pctOrNull(r.revenue_growth),
      operating_margin: pctOrNull(r.operating_margin),
      net_margin: pctOrNull(r.net_margin),
      roe: pctOrNull(r.roe),
      operating_cash_flow: r.cfo_approx,
      free_cash_flow: r.fcf_approx,
      current_ratio: r.current_ratio,
      quick_ratio: r.quick_ratio,
      cash_ratio: r.cash_ratio,
      debt_to_equity: r.debt_to_equity,
      equity_ratio: pctOrNull(r.equity_ratio),
    });
  }
  return inputs;
}

function numOrNull(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function pctOrNull(v: number | null): number | null {
  return v === null ? null : v * 100;
}

// ╔════════════════════════════════════════════════════════════════════╗
// ║  CORE SCORING                                                      ║
// ╚════════════════════════════════════════════════════════════════════╝

/**
 * Pick the band score for a metric using an "≥ threshold wins"
 * descending table (high-is-good metrics). Returns null when the
 * metric is null.
 */
function bandHighIsGood(
  value: number | null,
  table: Array<[number, number]>,
): number | null {
  if (value === null) return null;
  for (const [threshold, score] of table) {
    if (value >= threshold) return score;
  }
  return table[table.length - 1][1];
}

/**
 * Pick the band score for a metric using a "≤ threshold wins"
 * ascending table (low-is-good metrics, like debt/equity).
 */
function bandLowIsGood(
  value: number | null,
  table: Array<[number, number]>,
): number | null {
  if (value === null) return null;
  for (const [threshold, score] of table) {
    if (value <= threshold) return score;
  }
  return table[table.length - 1][1];
}

function trendScore(growthPct: number | null): number | null {
  if (growthPct === null) return null;
  if (growthPct > TREND_THRESHOLDS.improving_above_pct) return 100;
  if (growthPct < TREND_THRESHOLDS.declining_below_pct) return 30;
  return 70;
}

function profitabilityValue(input: ScoreInput): number | null {
  const ocfMargin =
    input.operating_cash_flow !== null &&
    input.revenue !== null &&
    input.revenue !== 0
      ? (input.operating_cash_flow / input.revenue) * 100
      : null;
  switch (PROFITABILITY_SOURCE) {
    case "net_margin":
      return input.net_margin;
    case "ocf_margin":
      return ocfMargin;
    case "blend":
      if (input.net_margin === null && ocfMargin === null) return null;
      if (input.net_margin === null) return ocfMargin;
      if (ocfMargin === null) return input.net_margin;
      return (input.net_margin + ocfMargin) / 2;
  }
}

/**
 * Score one fiscal year independently. Each component is in [20, 100]
 * (or null when its input is missing). The weighted average uses the
 * components present; missing ones drop out and the remaining weights
 * are renormalised so a year missing one signal isn't unfairly
 * penalised.
 */
export function scoreYear(input: ScoreInput): YearBreakdown {
  const components: Record<ComponentCode, number | null> = {
    L: bandHighIsGood(input.current_ratio, LIQUIDITY_BANDS),
    P: bandHighIsGood(profitabilityValue(input), PROFITABILITY_BANDS),
    S: bandLowIsGood(input.debt_to_equity, SOLVENCY_BANDS_UPPER),
    C: bandHighIsGood(input.cash_ratio, CASH_BANDS),
    R: bandHighIsGood(input.revenue, REVENUE_BANDS),
    T: trendScore(input.revenue_growth),
  };

  let weightSum = 0;
  let weightedTotal = 0;
  const missing: ComponentCode[] = [];
  for (const code of Object.keys(COMPONENT_WEIGHTS) as ComponentCode[]) {
    const v = components[code];
    const w = COMPONENT_WEIGHTS[code];
    if (v === null) {
      missing.push(code);
      continue;
    }
    weightSum += w;
    weightedTotal += w * v;
  }

  // Year score = renormalised weighted average. If literally every
  // component was missing, return 0 (caller will set low_confidence).
  const year_score =
    weightSum > 0 ? roundTo(weightedTotal / weightSum, 1) : 0;

  return {
    fiscal_year: input.fiscal_year,
    components,
    year_score,
    missing,
  };
}

function roundTo(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Recency-weighted blend of year scores; returns { base_score, weights }. */
function blendYears(yearScores: number[]): {
  base_score: number;
  weights: number[];
} {
  if (yearScores.length === 0) return { base_score: 0, weights: [] };
  let weights: number[];
  if (yearScores.length >= 3) {
    weights = [...RECENCY_3YR];
  } else if (yearScores.length === 2) {
    weights = [...RECENCY_2YR];
  } else {
    weights = [1];
  }
  // Use only as many years as we have weights for (top of the list).
  const useScores = yearScores.slice(0, weights.length);
  const sum = useScores.reduce((acc, s, i) => acc + s * weights[i], 0);
  return { base_score: roundTo(sum, 1), weights };
}

function trajectoryDelta(
  oldestYearScore: number,
  latestYearScore: number,
): number {
  const trend = latestYearScore - oldestYearScore;
  if (trend <= TRAJECTORY_DETERIORATING_DELTA) return -TRAJECTORY_ADJUSTMENT;
  if (trend >= TRAJECTORY_IMPROVING_DELTA) return TRAJECTORY_ADJUSTMENT;
  return 0;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function evaluateDistress(years: ScoreInput[]): DistressFlag[] {
  const flags: DistressFlag[] = [];
  if (years.length === 0) return flags;
  const latest = years[0];

  if (latest.equity !== null && latest.equity < 0) {
    flags.push("negative_equity");
  }
  if (
    latest.debt_to_equity !== null &&
    latest.debt_to_equity > DISTRESS_D_TO_E
  ) {
    flags.push("extreme_leverage");
  }
  if (
    latest.current_ratio !== null &&
    latest.current_ratio < 1.0 &&
    latest.net_profit !== null &&
    latest.net_profit < 0
  ) {
    flags.push("illiquid_and_loss_making");
  }
  if (
    latest.free_cash_flow !== null &&
    latest.free_cash_flow < 0 &&
    latest.revenue !== null &&
    latest.revenue > 0 &&
    Math.abs(latest.free_cash_flow) >
      latest.revenue * DISTRESS_FCF_ABS_OVER_REVENUE_RATIO
  ) {
    flags.push("cash_burn_exceeds_revenue");
  }

  // Multi-year: consecutive years of negative net profit.
  // Years are newest-first; scan for any run of 2+ consecutive losses.
  let run = 0;
  for (const y of years) {
    if (y.net_profit !== null && y.net_profit < 0) {
      run += 1;
      if (run >= DISTRESS_CONSECUTIVE_LOSS_YEARS) {
        flags.push("consecutive_losses");
        break;
      }
    } else if (y.net_profit !== null) {
      run = 0;
    }
    // If net_profit is null, neither extend nor reset the run — we
    // simply can't tell what happened that year.
  }

  return flags;
}

function detectStructuralChange(years: ScoreInput[]): boolean {
  // Compare each year to its previous in the *time* sense. Years are
  // newest-first so the "previous" year is the next index.
  for (let i = 0; i < years.length - 1; i++) {
    const newer = years[i];
    const older = years[i + 1];
    if (
      ratioChangeExceeds(
        newer.total_assets,
        older.total_assets,
        STRUCTURAL_CHANGE_RATIO,
      ) ||
      ratioChangeExceeds(
        newer.employees,
        older.employees,
        STRUCTURAL_CHANGE_RATIO,
      )
    ) {
      return true;
    }
  }
  return false;
}

function ratioChangeExceeds(
  newer: number | null,
  older: number | null,
  ratio: number,
): boolean {
  if (newer === null || older === null) return false;
  if (older === 0) return newer !== 0;
  return Math.abs(newer - older) / Math.abs(older) > ratio;
}

function tierFor(finalScore: number): Tier {
  if (finalScore >= TIER_CUTOFFS.strong) return "strong";
  if (finalScore >= TIER_CUTOFFS.moderate) return "moderate";
  if (finalScore >= TIER_CUTOFFS.weak) return "weak";
  return "avoid";
}

// ╔════════════════════════════════════════════════════════════════════╗
// ║  ENTRY POINT                                                       ║
// ╚════════════════════════════════════════════════════════════════════╝

/**
 * Score a company from one or more years of metrics. `inputs` should
 * be newest-first; if it's in another order, we re-sort by fiscal_year
 * descending before scoring.
 */
export function scoreCompany(inputs: ScoreInput[]): AbilityToPayScore {
  if (inputs.length === 0) {
    return emptyScore("No fiscal-year data on file — cannot score.");
  }

  // Sort newest-first, then cap the window to the most recent N years.
  // Everything downstream (per-year breakdown, volatility, trajectory,
  // distress checks, structural-change detection, explanation) operates
  // on this same window — so the score reflects current state and a
  // 5-year history doesn't bias against a company that turned around
  // 4 years ago.
  const years = [...inputs]
    .sort((a, b) => {
      // Anything with a fiscal_year goes first, newest-first. nulls
      // keep their relative order at the end so we don't lose them.
      const fa = a.fiscal_year ?? Number.NEGATIVE_INFINITY;
      const fb = b.fiscal_year ?? Number.NEGATIVE_INFINITY;
      return fb - fa;
    })
    .slice(0, MAX_HISTORY_YEARS);

  const per_year = years.map(scoreYear);
  const year_scores = per_year.map((y) => y.year_score);

  const { base_score, weights } = blendYears(year_scores);

  // Step 3 — trajectory modifier
  let adjusted = base_score;
  if (year_scores.length >= 2) {
    // Use the same window that blendYears used (top-N years).
    const window = year_scores.slice(0, weights.length);
    const delta = trajectoryDelta(window[window.length - 1], window[0]);
    adjusted = clamp(base_score + delta, 0, 100);
  }

  // Step 4 — volatility cap
  let volatile = false;
  if (year_scores.length >= 2) {
    const max = Math.max(...year_scores);
    const min = Math.min(...year_scores);
    if (max - min > VOLATILITY_RANGE_THRESHOLD) {
      volatile = true;
      adjusted = Math.min(adjusted, VOLATILITY_CAP);
    }
  }
  adjusted = roundTo(adjusted, 1);

  // Step 5 — distress override
  const distress = evaluateDistress(years);
  const override_capped = distress.length > 0;
  const final_score = override_capped
    ? Math.min(adjusted, DISTRESS_SCORE_CAP)
    : adjusted;

  // Step 6 — structural change (advisory only)
  const structural_change = detectStructuralChange(years);

  const limited_history = years.length < 2;
  const low_confidence =
    per_year[0]?.missing.length > 0 ||
    limited_history ||
    distress.length > 0;

  const result: AbilityToPayScore = {
    final_score: roundTo(final_score, 1),
    tier: tierFor(final_score),
    base_score,
    adjusted_score: adjusted,
    recency_weights: weights,
    per_year,
    distress_flags: distress,
    override_capped,
    flags: {
      limited_history,
      volatile,
      structural_change,
      low_confidence,
    },
    explanation: "",
  };
  result.explanation = buildExplanation(result, years);
  return result;
}

function emptyScore(reason: string): AbilityToPayScore {
  return {
    final_score: 0,
    tier: "avoid",
    base_score: 0,
    adjusted_score: 0,
    recency_weights: [],
    per_year: [],
    distress_flags: [],
    override_capped: false,
    flags: {
      limited_history: true,
      volatile: false,
      structural_change: false,
      low_confidence: true,
    },
    explanation: reason,
  };
}

// ╔════════════════════════════════════════════════════════════════════╗
// ║  EXPLANATION TEXT                                                  ║
// ╚════════════════════════════════════════════════════════════════════╝

const DISTRESS_DESCRIPTIONS: Record<DistressFlag, string> = {
  negative_equity: "balance sheet shows negative equity",
  extreme_leverage: "debt-to-equity above the 4× distress threshold",
  illiquid_and_loss_making:
    "current ratio below 1 while also posting a net loss",
  cash_burn_exceeds_revenue:
    "free cash flow burn exceeds annual revenue",
  consecutive_losses: "two or more consecutive years of net losses",
};

function buildExplanation(
  s: AbilityToPayScore,
  years: ScoreInput[],
): string {
  const parts: string[] = [];

  const tierWord = {
    strong: "Strong",
    moderate: "Moderate",
    weak: "Weak",
    avoid: "Avoid",
  }[s.tier];
  parts.push(`${tierWord} ability-to-pay (${s.final_score}/100).`);

  // What dominated the base score
  if (s.per_year.length > 0) {
    const latest = s.per_year[0];
    const sortedComponents = (Object.keys(latest.components) as ComponentCode[])
      .map((c) => ({ code: c, score: latest.components[c] }))
      .filter((c) => c.score !== null) as { code: ComponentCode; score: number }[];

    const weakest = [...sortedComponents]
      .sort((a, b) => a.score - b.score)
      .slice(0, 2);
    const strongest = [...sortedComponents]
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);

    if (weakest.length > 0 && weakest[0].score < 50) {
      parts.push(
        `Weakest signals: ${weakest
          .map((c) => `${componentLabel(c.code)} (${c.score})`)
          .join(", ")}.`,
      );
    } else if (strongest.length > 0 && strongest[0].score >= 80) {
      parts.push(
        `Strongest signals: ${strongest
          .map((c) => `${componentLabel(c.code)} (${c.score})`)
          .join(", ")}.`,
      );
    }
  }

  if (s.flags.limited_history) {
    parts.push("Only one fiscal year on file — confidence is reduced.");
  } else if (s.adjusted_score > s.base_score) {
    parts.push("Trajectory is improving across the window (+10 modifier).");
  } else if (s.adjusted_score < s.base_score) {
    parts.push("Trajectory is deteriorating across the window (-10 modifier).");
  }

  if (s.flags.volatile) {
    parts.push("Year-to-year scores swing widely — capped at 60.");
  }

  if (s.distress_flags.length > 0) {
    const descs = s.distress_flags
      .map((f) => DISTRESS_DESCRIPTIONS[f])
      .join("; ");
    parts.push(
      `Distress override fired: ${descs}. Final score capped at ${DISTRESS_SCORE_CAP}.`,
    );
  }

  if (s.flags.structural_change) {
    parts.push(
      "Total assets or headcount changed >50% YoY — trend may reflect acquisition or restructuring.",
    );
  }

  // Currency sanity reference — pull the latest revenue if present.
  if (years[0]?.revenue !== null && years[0]?.revenue !== undefined) {
    parts.push(
      `Latest revenue €${Math.round(years[0].revenue!).toLocaleString("en-US")}.`,
    );
  }

  return parts.join(" ");
}

function componentLabel(code: ComponentCode): string {
  return {
    L: "liquidity",
    P: "profitability",
    S: "solvency",
    C: "cash cushion",
    R: "revenue scale",
    T: "revenue trend",
  }[code];
}

// ╔════════════════════════════════════════════════════════════════════╗
// ║  Test surface — same convention as other modules in this repo.    ║
// ╚════════════════════════════════════════════════════════════════════╝

export const _testing = {
  bandHighIsGood,
  bandLowIsGood,
  trendScore,
  profitabilityValue,
  blendYears,
  trajectoryDelta,
  evaluateDistress,
  detectStructuralChange,
  tierFor,
};
