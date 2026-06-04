/**
 * French enrichment pipeline.
 *
 * Mirrors the shape of the Belgian KBO+NBB pipeline but uses INPI as
 * the single source. INPI returns both the structured `bilans-saisis`
 * data (already parsed cerfa codes — no LLM needed) and the original
 * PDFs. Director / mandate data isn't part of this endpoint; those
 * stay empty for French companies until a second source is wired up.
 *
 * Output is the existing CompanyFinancialReport shape, so the rest of
 * the app (cards, scoring, analyzer, charts) consumes BE and FR data
 * identically.
 */

import { DocumentRepository } from "../db/repository";
import { AmbiguousMatchError, NoFilingsError } from "../errors";
import { createLogger } from "../log";
import {
  Company,
  type CompanyFinancialReport,
  FilingReference,
  type FinancialStatement,
} from "../models";
import { formatSiren, tryNormaliseSiren } from "../siren";

import { bilanToFinancialStatement } from "./cerfa";
import { InpiClient, InpiError, InpiUnavailableError } from "./client";

const log = createLogger("pipeline:fr");

export type FrenchPipelineOptions = {
  filingsToRead?: number;
  onProgress?: (msg: string) => void;
};

const DEFAULT_FILINGS = 3;

export class FrenchPipeline {
  private readonly inpi: InpiClient;

  constructor(opts?: { inpi?: InpiClient }) {
    const inpi = opts?.inpi ?? InpiClient.create();
    if (inpi === null) {
      throw new InpiUnavailableError(
        "INPI is not configured. Set INPI_USERNAME and INPI_PASSWORD.",
      );
    }
    this.inpi = inpi;
  }

  async run(
    query: string,
    opts?: FrenchPipelineOptions,
  ): Promise<CompanyFinancialReport> {
    const notify = opts?.onProgress ?? (() => {});
    const limit = opts?.filingsToRead ?? DEFAULT_FILINGS;

    // Accept either a direct SIREN/SIRET or a free-text company name.
    // For names we hit /api/companies?companyName=... and resolve to
    // a single SIREN — falling through to the existing flow.
    const trimmed = query.trim();
    let siren = tryNormaliseSiren(trimmed);
    if (siren === null) {
      notify(`Searching INPI by name: ${JSON.stringify(trimmed)}`);
      siren = await this.resolveByName(trimmed);
    }
    notify(`Resolving SIREN ${formatSiren(siren)} via INPI`);
    log.info("run start", { siren, filings: limit });
    const t0 = performance.now();

    // 1. Attachments → list of bilans-saisis. Bilans PDF (not saisis)
    // are kept as an audit copy but only saisis carry structured data.
    let attachments;
    try {
      attachments = await this.inpi.getAttachments(siren);
    } catch (err) {
      if (err instanceof InpiError && err.status === 404) {
        throw new InpiError(404, `INPI has no record for SIREN ${siren}.`);
      }
      throw err;
    }

    // Filter out deletions, then sort newest-deposit first, take top N.
    const saisis = attachments.bilansSaisis
      .filter((b) => !b.deleted)
      .sort((a, b) => (b.dateDepot ?? "").localeCompare(a.dateDepot ?? ""))
      .slice(0, limit);
    log.info("attachments", {
      siren,
      saisis: saisis.length,
      pdfs: attachments.bilans.length,
    });

    if (saisis.length === 0) {
      // No structured filings — build a placeholder Company so the
      // caller can still display whatever metadata we have on file
      // (denomination from the PDF metadata, if present).
      const placeholderCompany = buildPlaceholderCompany(
        siren,
        attachments.bilans[0]?.denomination ?? null,
      );
      throw new NoFilingsError({
        enterprise_number: placeholderCompany.enterprise_number,
        name: placeholderCompany.name,
      });
    }

    // 2. Pull each bilan-saisi in turn and extract its FinancialStatement.
    notify(`Fetching ${saisis.length} structured filing(s) from INPI`);
    const refs: FilingReference[] = [];
    const statements: FinancialStatement[] = [];
    let identite: NonNullable<typeof identiteSeed> = identiteSeed;
    const docs = DocumentRepository.create();

    for (let i = 0; i < saisis.length; i++) {
      const meta = saisis[i];
      notify(`Extracting ${i + 1}/${saisis.length} (ref ${meta.id})`);
      let body;
      try {
        body = await this.inpi.getBilanSaisi(meta.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn("bilan-saisi fetch failed", { id: meta.id, error: msg });
        continue;
      }
      const bilan = body.bilanSaisi.bilan;
      // First successful identite block wins — they all describe the
      // same company; we just need one canonical copy.
      if (identite === identiteSeed) identite = bilan.identite;

      const ref = FilingReference.parse({
        reference: meta.id,
        deposit_date: meta.dateDepot ?? null,
        exercise_start: null, // INPI doesn't expose start, only end
        exercise_end: meta.dateCloture ?? bilan.identite.dateClotureExercice ?? null,
        model_type: bilan.identite.codeTypeBilan ?? null,
        language: "fr",
        accounting_format: "xbrl",
        storage_path: null,
        provider: "inpi",
      });

      // 3. Best-effort PDF upload — keep an audit copy in the bucket.
      // The bilans (PDF-only) list and bilansSaisis are separate INPI
      // collections; for the PDF we should look up the matching bilan
      // by numChrono. Fall back to the saisi id if no PDF match.
      const pdfId =
        attachments.bilans.find(
          (b) => b.numChrono === meta.numChrono && !b.deleted,
        )?.id ?? null;

      if (pdfId !== null && docs !== null) {
        try {
          const pdfBytes = await this.inpi.downloadBilanPdf(pdfId);
          if (pdfBytes !== null) {
            const path = await docs.upload(siren, ref.reference, pdfBytes);
            if (path !== null) ref.storage_path = path;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn("pdf upload skipped", { id: pdfId, error: msg });
        }
      }

      refs.push(ref);

      // 4. Cerfa extraction (deterministic, no LLM).
      const statement = bilanToFinancialStatement(siren, ref, bilan);
      if (statement !== null) {
        statements.push(statement);
      } else {
        log.warn("layout not mapped — keeping PDF only", {
          id: meta.id,
          typeBilan: bilan.identite.codeTypeBilan,
        });
      }
    }

    const company = buildCompany(siren, identite, attachments.bilans[0]);

    notify("Done");
    log.info("run end", {
      siren,
      refs: refs.length,
      statements: statements.length,
      ms: Math.round(performance.now() - t0),
    });
    return { company, filings: refs, statements };
  }

  /**
   * Free-text name → single SIREN. Mirrors the KBO `resolveByName`
   * shape so the rest of the pipeline doesn't need to know whether
   * the input was a SIREN or a name.
   *
   * Resolution rules, in order:
   *   - 0 results               → InpiError(404, "no match")
   *   - 1 result                → use it
   *   - exactly 1 exact-name    → use it (case-insensitive)
   *   - otherwise               → AmbiguousMatchError(candidates)
   *
   * The AmbiguousMatchError surfaces through the existing 409 path
   * and the `AmbiguousMatches` UI dropdown — the same component used
   * for Belgian name disambiguation.
   */
  private async resolveByName(name: string): Promise<string> {
    const candidates = await this.inpi.searchByName(name);
    if (candidates.length === 0) {
      throw new InpiError(404, `No INPI match for ${JSON.stringify(name)}.`);
    }
    if (candidates.length === 1) return candidates[0].siren;

    const lower = name.toLowerCase();
    const exact = candidates.filter(
      (c) => c.denomination.toLowerCase() === lower,
    );
    if (exact.length === 1) return exact[0].siren;

    throw new AmbiguousMatchError(
      candidates.slice(0, 25).map((c) => ({
        enterprise_number: c.siren,
        name: c.denomination,
        address: c.address,
      })),
      `${candidates.length} INPI matches for ${JSON.stringify(name)}; refine the query.`,
    );
  }
}

// Sentinel for "no identite captured yet". Strict-equality compared
// against later assignments above.
const identiteSeed = {
  siren: "",
  dateClotureExercice: null,
  codeGreffe: null,
  numDepot: null,
  numGestion: null,
  codeActivite: null,
  dateClotureExerciceNMoins1: null,
  dureeExerciceN: null,
  dureeExerciceNMoins1: null,
  dateDepot: null,
  codeSaisie: null,
  codeTypeBilan: null,
  codeDevise: null,
  codeOrigineDevise: null,
  codeConfidentialite: null,
  infoTraitement: null,
  denomination: null,
  adresse: null,
} as const;

function buildCompany(
  siren: string,
  identite: typeof identiteSeed,
  pdfRef: { denomination?: string | null } | undefined,
): Company {
  const name =
    identite.denomination?.trim() ||
    pdfRef?.denomination?.trim() ||
    null;
  const nace = identite.codeActivite
    ? [
        {
          code: identite.codeActivite,
          description: null,
          source: "NAF",
          version: null,
          since: null,
        },
      ]
    : [];
  return Company.parse({
    enterprise_number: siren,
    country: "FR",
    name,
    trade_name: null,
    legal_form: null,
    address: identite.adresse?.trim() || null,
    status: null,
    start_date: null,
    dissolution_date: null,
    vat_subject: null,
    nace_codes: nace,
    functions: [],
    corporate_mandates: [],
  });
}

function buildPlaceholderCompany(
  siren: string,
  name: string | null,
): Company {
  return Company.parse({
    enterprise_number: siren,
    country: "FR",
    name,
    trade_name: null,
    legal_form: null,
    address: null,
    status: null,
    start_date: null,
    dissolution_date: null,
    vat_subject: null,
    nace_codes: [],
    functions: [],
    corporate_mandates: [],
  });
}
