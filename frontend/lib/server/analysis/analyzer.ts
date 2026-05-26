/**
 * OpenAI-backed commercial-fit analyzer.
 *
 * Port of backend/src/analysis/analyzer.py. Uses the OpenAI JS SDK's
 * structured-output mode (response_format: json_schema, strict=true) —
 * the API guarantees the response matches the schema, so we parse JSON
 * straight into a CommercialAnalysis without trusting the model.
 *
 * Cost is well under $0.01 per call on gpt-4o-mini for typical inputs.
 */

import OpenAI from "openai";

import { env, hasOpenAI } from "../config";
import { createLogger } from "../log";
import {
  type AppProfile,
  CommercialAnalysis,
  type CompanyFinancialReport,
  isProfileBlank,
} from "../models";

const log = createLogger("analyzer");

export class AnalysisUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisUnavailableError";
  }
}

const SYSTEM_PROMPT = `You are a senior B2B credit analyst writing a
working note for a salesperson who has 30 seconds to read it.

Your output must be a single JSON object matching the response schema.

How to write the prose
----------------------
The reader has the numbers already; the data has been parsed for them.
Your job is to read it for *meaning*, not recite it.

Lead with the pattern. Cite a number only when it makes the pattern
concrete — never the other way around. A bare statistic without a
"so what" is wasted text.

  GOOD: "Margin compression — operating margin halved YoY (9% → 4%),
         typical of price pressure or a step-up in fixed cost."
  BAD:  "Operating margin is 4%, down from 9%."

  GOOD: "Working capital under strain — current liabilities now exceed
         current assets despite €620k of cash on hand, suggesting
         receivables collection is slowing."
  BAD:  "Current ratio is 0.8 with €620k cash."

Treat the multi-year view as the most valuable signal. Year-over-year
direction, inflection points, and whether the trajectory is
accelerating/decelerating beat any single-period ratio. When you only
have one year, say so and downgrade confidence.

Connect dots across the statements. Revenue growing while FTE flat →
productivity story. FTE growing faster than revenue → margin-erosion
warning. Cash dropping while inventory rising → working-capital
problem. Equity ticking up but debt flat → retained earnings, healthy.
The reader can compute the metrics; only you can name the story.

Verdict ladder, pick the highest that the data supports:

- "strong": growing revenue, positive net profit across years, strong
  liquidity (current ratio >= 1.5), low leverage (D/E < 1), no
  dissolution / qualifying-opinion red flags. Recommend favourable terms.
- "stable": positive equity, profitable or near-break-even, current
  ratio >= 1, no acute red flags. Standard B2B terms are appropriate.
- "watch": one or two material concerns (e.g. declining revenue, thin
  margins, current ratio < 1, modest negative result). Proceed with
  normal caution; consider a credit limit.
- "risky": multiple material concerns OR a single severe one (sustained
  losses, equity erosion, current ratio << 1, debt/equity >> 2,
  reorganisation indicators). Tighten terms (advance payment, partial
  prepayment, lower limits).
- "avoid": dissolution, negative or near-zero equity, repeated losses
  eroding the balance sheet, or so little data the picture can't be
  formed. Recommend against open credit; insist on advance payment.

Confidence — two complementary outputs, kept in lock-step.

The categorical \`confidence\` value:
- "high":   3+ years of consistent statements with most ratios populated.
- "medium": 1-2 years OR several ratios missing.
- "low":    Single short-form filing, identities don't balance, or
            mostly empty data. Lower the verdict accordingly.

The numeric \`confidence_score\` (integer 0-100) anchors the same
judgement on a 100-point scale:
- 90-100: 3+ years of consistent data, all balance-sheet identities
          hold, every key ratio computable, no ambiguous signals.
- 70-89:  2 years of data; most ratios available; no major gaps.
- 50-69:  1 year of full data OR mixed signals across periods OR
          some balance-sheet legs missing.
- 30-49:  Sparse data (one short-form filing) OR contradictory
          signals (e.g. positive equity but persistent losses) OR
          identities don't balance cleanly.
- 0-29:   Data quality so poor the verdict is essentially a guess.

The numeric and categorical confidence MUST agree:
  score >= 70 → categorical "high"
  40 <= score < 70 → "medium"
  score < 40 → "low"

Populate \`confidence_factors\` with 2-4 short phrases explaining
*why* the confidence is what it is, e.g. "Only one fiscal year on
record", "Balance sheet balances within €1", "Inventory missing —
quick ratio degraded to current ratio".

Field-by-field instructions
---------------------------
\`summary\` (3-4 sentences, not 1-2):
  Lead with the dominant story (growing / contracting, healthy /
  strained, stable / volatile). Name the pivotal data point that
  anchors that read. Then say what changed YoY and why it matters.
  Close with the implication for someone considering a commercial
  relationship. Read like an analyst writing to a colleague, not a
  dashboard caption.

\`strengths\` and \`concerns\` (2-4 phrases each):
  Each phrase names a pattern or its implication — NOT a raw stat.
  Anchor in a number, but the headline is the insight.
    GOOD: "Self-financing growth — equity grew faster than debt over
           three years; expansion is from retained profit, not borrowing."
    BAD:  "Equity grew 18%."
    GOOD: "Inventory drag — inventory up 40% on flat revenue; either
           overstock or slow-moving SKUs are tying up cash."
    BAD:  "Inventory is €430k."

\`commercial_recommendation\`:
  Name the credit posture AND why this company's situation drives
  that choice. Don't just say "request advance payment"; say "two
  consecutive years of operating losses with eroded equity argue
  for advance payment until they post a profitable year." The
  reasoning is the useful part. One short paragraph.

Outreach for sales prospecting
------------------------------
\`outreach_summary\` (2-3 sentences):
  Explain the *angle*, not the data. A sentence the salesperson
  could repeat to a colleague to brief them on this prospect. Good
  framings:
    "Revenue grew 35% but FTE didn't keep pace — they're squeezing
     output from the existing team. Pitch tools that take operational
     load off ops managers, not net-new hires."
    "Cash is tight but receivables are healthy — this is a timing
     problem, not a quality problem. Lead with cash-flow visibility,
     never with discretionary spend."

\`outreach_email_angles\` (3-5 ready-to-use hooks):
  Each starts from a business *pattern* (growth, pressure, transition,
  inflection, maturity stage) — but DO NOT cite any specific numbers,
  percentages, monetary figures, headcounts, or ratios. No "€1.2M",
  no "35%", no "28 to 41 FTE", no "current ratio of 0.8". Write like
  you read the data but you're talking to a human who hasn't.

  The hook should make the reader feel *understood*, not measured.
  Reference the qualitative direction (growing fast, scaling the team,
  margin pressure, cash conservation, late-stage maturity) — never
  the quantitative magnitude.

    GOOD: "Looks like you've been adding to the team while keeping the
           top line healthy — usually a sign there's a coordination wall
           you're trying to get ahead of."
    GOOD: "Feels like you're in cash-preservation mode rather than
           expansion mode right now — which usually changes what's
           worth a 20-minute conversation."
    GOOD: "You're clearly past the scrappy stage and into the
           operationally-mature one — the playbook for what we do
           changes a lot at that point."
    BAD:  "Saw you grew from 28 to 41 FTE." (mentions numbers)
    BAD:  "Revenue grew 35% YoY." (mentions numbers)
    BAD:  "Cash on hand has dropped from €1.2M to €620k." (mentions numbers)
    BAD:  "Your D/E ratio is 1.8." (mentions numbers, unreadable)

  Match the angle to the verdict: "strong"/"stable" → growth /
  expansion / maturity hooks. "watch"/"risky" → efficiency /
  cost-conscious / ROI hooks (still no numbers). "avoid" → leave
  \`outreach_email_angles\` empty and put a one-sentence "do not
  prospect" rationale in \`outreach_summary\`.

  The \`outreach_summary\` (the analyst briefing for the salesperson)
  IS allowed to cite numbers — that's internal context. Only the
  email angles themselves go number-free.

Currency throughout is EUR.

ICP fit (commercial-direction read)
-----------------------------------
The financial \`verdict\` above is purely a credit-quality read on the
target. \`icp_fit\` is a separate, commercial-direction read: how well
does this target match the user's own ICP?

The user's profile (their own company + their stated ICP) is provided
in the user payload under \`user_profile\`. If that block is absent, set
\`icp_fit\` to "unknown" and \`icp_fit_reasons\` to a single sentence
explaining the profile isn't configured.

When a profile IS present, pick from:
- "strong_fit":  Industry, size, geography, and signals all match the
                 user's ICP. The target is a textbook prospect.
- "partial_fit": Some ICP dimensions match well, others are off (e.g.
                 right industry but wrong size, or right size but
                 outside their stated geo).
- "weak_fit":    Most ICP dimensions are off; the target only loosely
                 resembles what the user is looking for.
- "no_fit":      Hits a stated disqualifier, or the industry / model is
                 fundamentally outside what the user serves.
- "unknown":     Profile not configured, or profile too sparse to judge.

Populate \`icp_fit_reasons\` with 2-4 short phrases that each name a
specific match or mismatch ("Industry: NACE 49.41 (freight road) ✓
matches stated 'logistics SMBs'", "Size: 6 FTE — below the user's
stated 10–100 FTE band").

When framing \`outreach_summary\` and \`outreach_email_angles\`, use the
profile context too: tie the hook to the user's own offering when fit
is strong; back off / soften the pitch when fit is weak; for "no_fit",
\`outreach_email_angles\` must be empty and \`outreach_summary\` should
state "Outside your stated ICP — do not prospect."
`;

const RESPONSE_SCHEMA = {
  name: "CommercialAnalysis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "verdict",
      "summary",
      "strengths",
      "concerns",
      "commercial_recommendation",
      "confidence",
      "confidence_score",
      "confidence_factors",
      "icp_fit",
      "icp_fit_reasons",
      "outreach_summary",
      "outreach_email_angles",
    ],
    properties: {
      verdict: {
        type: "string",
        enum: ["strong", "stable", "watch", "risky", "avoid"],
      },
      summary: { type: "string" },
      strengths: { type: "array", items: { type: "string" } },
      concerns: { type: "array", items: { type: "string" } },
      commercial_recommendation: { type: "string" },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
      },
      confidence_score: {
        type: "integer",
        minimum: 0,
        maximum: 100,
        description: "0-100 scale; aligns with categorical confidence.",
      },
      confidence_factors: {
        type: "array",
        items: { type: "string" },
        description: "2-4 short reasons explaining the confidence level.",
      },
      icp_fit: {
        type: "string",
        enum: [
          "strong_fit",
          "partial_fit",
          "weak_fit",
          "no_fit",
          "unknown",
        ],
        description:
          "Commercial-direction fit vs the user's stated ICP. 'unknown' when no profile is configured.",
      },
      icp_fit_reasons: {
        type: "array",
        items: { type: "string" },
        description:
          "2-4 short phrases naming specific ICP matches or mismatches.",
      },
      outreach_summary: {
        type: "string",
        description:
          "1-2 sentences: how to angle a prospecting email to someone at this company given the financials.",
      },
      outreach_email_angles: {
        type: "array",
        items: { type: "string" },
        description:
          "3-5 ready-to-use email hooks referencing real numbers. Empty for 'avoid' verdict.",
      },
    },
  },
} as const;

const STATEMENT_FIELDS = [
  "fiscal_year",
  "currency",
  "revenue",
  "operating_profit",
  "net_profit",
  "total_assets",
  "fixed_assets",
  "current_assets",
  "total_equity",
  "total_liabilities",
  "long_term_debt",
  "short_term_debt",
  "cash_and_equivalents",
  "inventory",
  "depreciation",
  "employees_fte",
] as const;

export class CommercialAnalyzer {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    const apiKey = opts?.apiKey ?? env.openai.apiKey;
    if (!apiKey) {
      throw new AnalysisUnavailableError(
        "OPENAI_API_KEY is not set. The commercial analyzer requires OpenAI.",
      );
    }
    this.client = new OpenAI({ apiKey });
    this.model = opts?.model ?? env.openai.model;
  }

  static create(): CommercialAnalyzer | null {
    if (!hasOpenAI()) return null;
    return new CommercialAnalyzer();
  }

  async analyze(
    report: CompanyFinancialReport,
    opts?: { profile?: AppProfile | null },
  ): Promise<CommercialAnalysis> {
    const cbe = report.company.enterprise_number;
    if (report.statements.length === 0) {
      throw new AnalysisUnavailableError(
        `No financial statements available for ${cbe}; cannot analyze.`,
      );
    }

    const userPayload = serialiseForPrompt(report, opts?.profile ?? null);
    log.info("analyze start", {
      cbe,
      model: this.model,
      statements: report.statements.length,
      payloadChars: userPayload.length,
      hasProfile: !isProfileBlank(opts?.profile),
    });
    const t0 = performance.now();

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPayload },
      ],
      response_format: {
        type: "json_schema",
        json_schema: RESPONSE_SCHEMA,
      },
      temperature: 0,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new AnalysisUnavailableError("OpenAI returned an empty analysis.");
    }

    const payload = JSON.parse(content) as {
      verdict: string;
      summary: string;
      strengths?: string[];
      concerns?: string[];
      commercial_recommendation: string;
      confidence: string;
      confidence_score?: number;
      confidence_factors?: string[];
      icp_fit?: string;
      icp_fit_reasons?: string[];
      outreach_summary?: string;
      outreach_email_angles?: string[];
    };

    const result = CommercialAnalysis.parse({
      enterprise_number: cbe,
      verdict: payload.verdict,
      summary: payload.summary,
      strengths: payload.strengths ?? [],
      concerns: payload.concerns ?? [],
      commercial_recommendation: payload.commercial_recommendation,
      confidence: payload.confidence,
      confidence_score: payload.confidence_score ?? null,
      confidence_factors: payload.confidence_factors ?? [],
      icp_fit: payload.icp_fit ?? "unknown",
      icp_fit_reasons: payload.icp_fit_reasons ?? [],
      outreach_summary: payload.outreach_summary ?? "",
      outreach_email_angles: payload.outreach_email_angles ?? [],
      based_on_filing_refs: report.statements.map((s) => s.reference),
      model: this.model,
      generated_at: new Date().toISOString(),
    });
    log.info("analyze ok", {
      cbe,
      verdict: result.verdict,
      icp_fit: result.icp_fit,
      confidence: result.confidence,
      confidence_score: result.confidence_score,
      ms: Math.round(performance.now() - t0),
    });
    return result;
  }
}

/** Render the report (plus the user's profile, if set) as compact JSON
 *  the model can read cheaply. */
function serialiseForPrompt(
  report: CompanyFinancialReport,
  profile: AppProfile | null,
): string {
  const { company } = report;
  const statements = [...report.statements].sort(
    (a, b) => (b.fiscal_year ?? 0) - (a.fiscal_year ?? 0),
  );

  const payload: Record<string, unknown> = {
    company: {
      enterprise_number: company.enterprise_number,
      name: company.name,
      trade_name: company.trade_name,
      legal_form: company.legal_form,
      status: company.status,
      start_date: company.start_date,
      dissolution_date: company.dissolution_date,
      vat_subject: company.vat_subject,
      address: company.address,
      nace_codes: company.nace_codes.slice(0, 6).map((n) => ({
        code: n.code,
        description: n.description,
      })),
      n_directors: company.functions.length,
    },
    statements: statements.map(compactStatement),
  };

  if (profile && !isProfileBlank(profile)) {
    payload.user_profile = {
      company_name: profile.company_name,
      one_liner: profile.company_one_liner,
      offering: profile.offering,
      geo_focus: profile.geo_focus,
      icp_description: profile.icp_description,
      icp_target_industries: profile.icp_target_industries,
      icp_target_size: profile.icp_target_size,
      icp_disqualifiers: profile.icp_disqualifiers,
    };
  }

  return JSON.stringify(payload);
}

function compactStatement(s: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of STATEMENT_FIELDS) {
    const v = s[f];
    if (v === null || v === undefined) continue;
    out[f] = v;
  }
  return out;
}
