/**
 * Cerfa code → FinancialStatement field mapper.
 *
 * INPI returns annual accounts as a list of `liasses` (cerfa codes
 * with 1–4 numeric columns). We translate the codes we care about
 * into our normalised FinancialStatement shape. Two layouts are
 * supported here:
 *
 *   - "C"  Comptes annuels complets (full accounts)
 *   - "S"  Comptes annuels simplifiés (small companies, abridged)
 *
 * These cover ≳95% of SMB filings. Other layouts (consolidés "K",
 * banques "B", assurances, agricoles) return null from this mapper —
 * the pipeline still uploads the original PDF, just doesn't extract
 * structured figures for them.
 *
 * Reference: INPI doc v5 (June 2025), section E — "Organisation des
 * données saisies par type de compte annuel".
 *
 * Numeric values arrive as zero-padded strings with optional sign
 * ("000000000001220" = 1220 €, "-000000001127414" = -1 127 414 €).
 * We strip the padding, parse to number, then re-serialise as decimal
 * strings to match the existing FinancialStatement.numericString shape.
 */

import { Decimal } from "decimal.js";

import {
  FilingReference,
  FinancialStatement,
  fiscalYear,
} from "../models";

import type { InpiBilanSaisi, InpiLiasse } from "./client";

// ── Codes we extract — one entry per FinancialStatement numeric field. ─

/**
 * A code lookup: {page, code, column}. Column is 1-indexed into the
 * `m1..m4` quadruple. The mapping below picks the column that holds
 * the "net N" (current year, final value) figure for each layout.
 *
 * Some FinancialStatement fields don't map cleanly to a single cerfa
 * code on a simplified bilan; in that case we provide multiple
 * fallback codes and use the first that's populated.
 */
type Probe = { page: number; code: string; col: 1 | 2 | 3 | 4 };

/** Mapping table for typeBilan = "C" (comptes annuels complets). */
const COMPLET: Record<keyof Mappable, Probe[]> = {
  revenue: [{ page: 3, code: "FJ", col: 3 }], // Chiffres d'affaires nets — Total N
  operating_profit: [{ page: 3, code: "GG", col: 3 }], // Résultat d'exploitation
  net_profit: [{ page: 4, code: "HN", col: 1 }], // Bénéfice ou perte
  // Balance sheet figures use page 01 column 3 = "Net année N".
  total_assets: [{ page: 1, code: "CO", col: 3 }], // Total général actif
  fixed_assets: [{ page: 1, code: "BJ", col: 3 }], // TOTAL (I) actif immobilisé
  current_assets: [{ page: 1, code: "CJ", col: 3 }], // TOTAL (II) actif circulant
  total_equity: [{ page: 2, code: "DL", col: 1 }], // TOTAL (I) capitaux propres
  total_liabilities: [{ page: 2, code: "EC", col: 1 }], // TOTAL (IV) dettes
  long_term_debt: [{ page: 2, code: "DU", col: 1 }], // Emprunts dettes auprès des Ets de crédit
  // INPI separates short-term debt only on page 8 (état des dettes).
  // VG = "Emprunts à 1 an maximum à l'origine".
  short_term_debt: [{ page: 8, code: "VG", col: 1 }],
  cash_and_equivalents: [{ page: 1, code: "CF", col: 3 }], // Disponibilités
  // Inventory: sum of stock buckets, but BR (produits finis) alone is
  // the single most-populated cell on small filings; on bigger ones
  // we'd want to sum BL+BN+BP+BR+BT. For v1 use BR with BL fallback.
  inventory: [
    { page: 1, code: "BR", col: 3 },
    { page: 1, code: "BL", col: 3 },
  ],
  depreciation: [{ page: 3, code: "GA", col: 3 }], // Dotations exploit. amortissements
  employees_fte: [{ page: 11, code: "YP", col: 1 }],
};

/** Mapping table for typeBilan = "S" (comptes annuels simplifiés). */
const SIMPLIFIE: Record<keyof Mappable, Probe[]> = {
  // Revenue: domestic + export (or simply FR domestic).
  revenue: [
    { page: 2, code: "210", col: 1 },
    { page: 2, code: "214", col: 1 },
    { page: 2, code: "218", col: 1 },
  ],
  operating_profit: [{ page: 2, code: "270", col: 1 }],
  net_profit: [{ page: 2, code: "310", col: 1 }],
  total_assets: [{ page: 1, code: "110", col: 3 }], // Total général actif
  fixed_assets: [{ page: 1, code: "044", col: 3 }], // Total actif immobilisé
  current_assets: [{ page: 1, code: "096", col: 3 }], // Total actif circulant
  total_equity: [{ page: 1, code: "142", col: 3 }], // Total capitaux propres
  total_liabilities: [{ page: 1, code: "176", col: 3 }], // Total des dettes
  long_term_debt: [{ page: 1, code: "195", col: 3 }], // Dont dettes à plus d'un an
  short_term_debt: [{ page: 1, code: "156", col: 3 }], // Emprunts et dettes assimilées
  cash_and_equivalents: [{ page: 1, code: "084", col: 3 }], // Disponibilités
  inventory: [{ page: 1, code: "050", col: 3 }], // Matières + marchandises
  depreciation: [{ page: 2, code: "254", col: 1 }], // Dotations aux amortissements
  employees_fte: [{ page: 2, code: "376", col: 1 }],
};

/** Fields the mapper can populate. The rest of FinancialStatement
 *  (enterprise_number, reference, fiscal_year, currency, source) is
 *  derived from the parent FilingReference, not the cerfa table. */
type Mappable = {
  revenue: string | null;
  operating_profit: string | null;
  net_profit: string | null;
  total_assets: string | null;
  fixed_assets: string | null;
  current_assets: string | null;
  total_equity: string | null;
  total_liabilities: string | null;
  long_term_debt: string | null;
  short_term_debt: string | null;
  cash_and_equivalents: string | null;
  inventory: string | null;
  depreciation: string | null;
  employees_fte: string | null;
};

/**
 * Translate a cerfa-coded bilan into a FinancialStatement. Returns
 * null when the layout isn't one we support, or when codeSaisie says
 * the document was rejected at INPI's intake (no `detail` block).
 */
export function bilanToFinancialStatement(
  enterpriseNumber: string,
  ref: FilingReference,
  bilan: InpiBilanSaisi,
): FinancialStatement | null {
  const layout = bilan.identite.codeTypeBilan;
  const table = pickTable(layout);
  if (table === null) return null;
  if (!bilan.detail) return null;

  const pages = bilan.detail.pages;
  const fields: Mappable = {
    revenue: null,
    operating_profit: null,
    net_profit: null,
    total_assets: null,
    fixed_assets: null,
    current_assets: null,
    total_equity: null,
    total_liabilities: null,
    long_term_debt: null,
    short_term_debt: null,
    cash_and_equivalents: null,
    inventory: null,
    depreciation: null,
    employees_fte: null,
  };

  for (const key of Object.keys(table) as (keyof Mappable)[]) {
    fields[key] = sumProbes(pages, table[key]);
  }

  return FinancialStatement.parse({
    enterprise_number: enterpriseNumber,
    reference: ref.reference,
    fiscal_year: fiscalYear(ref),
    exercise_start: ref.exercise_start,
    exercise_end: ref.exercise_end,
    currency: bilan.identite.codeDevise ?? "EUR",
    revenue: fields.revenue,
    operating_profit: fields.operating_profit,
    net_profit: fields.net_profit,
    total_assets: fields.total_assets,
    fixed_assets: fields.fixed_assets,
    current_assets: fields.current_assets,
    total_equity: fields.total_equity,
    total_liabilities: fields.total_liabilities,
    long_term_debt: fields.long_term_debt,
    short_term_debt: fields.short_term_debt,
    cash_and_equivalents: fields.cash_and_equivalents,
    inventory: fields.inventory,
    depreciation: fields.depreciation,
    employees_fte: fields.employees_fte,
    source: "xbrl", // not really XBRL, but it's structured-not-pdf
    provider: "inpi",
    raw_headings: {},
  });
}

function pickTable(layout: string | null): Record<keyof Mappable, Probe[]> | null {
  switch (layout) {
    case "C":
      return COMPLET;
    case "S":
      return SIMPLIFIE;
    // "K" (consolidés), "B" (banques), assurances, agricoles — TODO.
    // For now we return null so the pipeline skips structured extraction
    // and only keeps the stored PDF.
    default:
      return null;
  }
}

/**
 * Sum every probe that returns a value, treating any null as 0 only
 * when at least one probe in the list resolved. If every probe is
 * absent, the field stays null (distinguishes "reported zero" from
 * "not reported").
 */
function sumProbes(
  pages: Array<{ numero: number; liasses: InpiLiasse[] }>,
  probes: Probe[],
): string | null {
  let total = new Decimal(0);
  let anyFound = false;
  for (const p of probes) {
    const v = readCell(pages, p);
    if (v !== null) {
      total = total.plus(v);
      anyFound = true;
    }
  }
  if (!anyFound) return null;
  return total.toString();
}

function readCell(
  pages: Array<{ numero: number; liasses: InpiLiasse[] }>,
  probe: Probe,
): Decimal | null {
  const page = pages.find((pg) => pg.numero === probe.page);
  if (!page) return null;
  const liasse = page.liasses.find((l) => l.code === probe.code);
  if (!liasse) return null;
  const raw = readColumn(liasse, probe.col);
  if (raw === null) return null;
  return parseSignedAmount(raw);
}

function readColumn(liasse: InpiLiasse, col: 1 | 2 | 3 | 4): string | null {
  switch (col) {
    case 1:
      return liasse.m1 || null;
    case 2:
      return liasse.m2 || null;
    case 3:
      return liasse.m3 || null;
    case 4:
      return liasse.m4 || null;
  }
}

/**
 * INPI numeric strings are zero-padded, e.g. "000000000001220" or
 * "-000000001127414". Strip the padding, preserve the sign, return a
 * Decimal. Returns null on unparseable input rather than throwing —
 * the cerfa table is best-effort.
 */
function parseSignedAmount(raw: string): Decimal | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const negative = trimmed.startsWith("-");
  const digits = trimmed.replace(/^[+-]/, "").replace(/^0+(?=\d)/, "");
  if (!/^\d+$/.test(digits || "0")) return null;
  try {
    const d = new Decimal(digits || "0");
    return negative ? d.neg() : d;
  } catch {
    return null;
  }
}

// Expose internals for unit-testing.
export const _testing = { parseSignedAmount, COMPLET, SIMPLIFIE };
