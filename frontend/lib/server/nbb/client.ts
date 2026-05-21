/**
 * Client for the NBB Central Balance Sheet Office Authentic Data Query API.
 *
 * XBRL-only port of backend/src/nbb/client.py. The PDF/JSON fallback
 * paths from the Python version are gone — the pipeline now relies on
 * XBRL as the single source of structured accounting data.
 *
 * Endpoint paths and the subscription-key header mirror the NBB
 * developer-portal layout. The subscription key and base URL come from
 * env (see lib/server/config.ts).
 */

import { NBBClientError, NBBNotFoundError } from "../errors";
import { env } from "../config";
import { FilingFormat, FilingReference } from "../models";

const REFERENCES_PATH = "/legalEntity/{cbe}/references";

/**
 * NBB's deposit endpoint is content-negotiated: same URL serves the
 * PDF or the XBRL depending on the Accept header. The vendor MIME
 * `application/x.xbrl` is what NBB actually serves XBRL with — the
 * standard `application/xbrl+xml` gets you a PDF back regardless of
 * intent, so we hard-code the vendor form.
 */
const ACCEPT_XBRL = "application/x.xbrl";
const ACCEPT_PDF = "application/pdf";

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/** Belgian + EU date formats found in NBB JSON payloads. */
function parseDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, 19);
  // ISO with optional time
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // DD/MM/YYYY or DD.MM.YYYY
  const dmy = trimmed.match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return null;
}

function coerceReferenceList(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === "object") {
    for (const key of ["references", "items", "data", "results"]) {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as Record<string, unknown>[];
    }
  }
  return [];
}

function parseReference(item: Record<string, unknown>): FilingReference {
  const rawFormat = String(
    item.AccountingDataURL ?? item.format ?? "",
  ).toLowerCase();

  let fmt: FilingFormat = "pdf";
  if (rawFormat.includes("xbrl") || item.hasXbrl || item.xbrlAvailable) {
    fmt = "xbrl";
  } else if (item.hasPdf === false) {
    fmt = "unknown";
  }

  const exerciseDates =
    item.ExerciseDates && typeof item.ExerciseDates === "object"
      ? (item.ExerciseDates as Record<string, unknown>)
      : null;

  return FilingReference.parse({
    reference: String(item.ReferenceNumber ?? item.reference ?? item.id ?? ""),
    deposit_date: parseDate(item.DepositDate ?? item.depositDate),
    exercise_start: parseDate(
      exerciseDates?.startDate ??
        item.exerciseStartDate ??
        item.startDate,
    ),
    exercise_end: parseDate(
      exerciseDates?.endDate ?? item.exerciseEndDate ?? item.endDate,
    ),
    model_type: (item.ModelType ?? item.modelType ?? null) as string | null,
    language: (item.Language ?? item.language ?? null) as string | null,
    accounting_format: fmt,
  });
}

/**
 * Drop duplicate filings for the same fiscal period.
 *
 * When a company re-files (correction), both versions share the same
 * (exercise_start, exercise_end). Since the input list is already
 * sorted by (exercise_end DESC, deposit_date DESC), the first entry
 * per period is the most recent deposit — keep it.
 */
function deduplicate(refs: FilingReference[]): FilingReference[] {
  const seen = new Set<string>();
  const out: FilingReference[] = [];
  for (const ref of refs) {
    const key = `${ref.exercise_start ?? ""}|${ref.exercise_end ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

export class NBBClient {
  private readonly baseUrl: string;
  private readonly subscriptionKey: string;
  private readonly depositPath: string;
  private readonly timeoutMs: number;

  constructor() {
    if (!env.nbb.subscriptionKey) {
      throw new NBBClientError(
        "NBB_API_SUBSCRIPTION_KEY is not set. Request access at " +
          "https://www.nbb.be/en/central-balance-sheet-office/consultation/web-services.",
      );
    }
    this.baseUrl = env.nbb.baseUrl.replace(/\/$/, "");
    this.subscriptionKey = env.nbb.subscriptionKey;
    this.depositPath = env.nbb.depositPath;
    this.timeoutMs = env.http.timeoutMs;
  }

  /** Return every filing reference NBB knows about for this CBE. */
  async listReferences(enterpriseNumber: string): Promise<FilingReference[]> {
    const cbe = digitsOnly(enterpriseNumber);
    let payload: unknown;
    try {
      payload = await this.fetchJson(
        REFERENCES_PATH.replace("{cbe}", cbe),
      );
    } catch (err) {
      if (err instanceof NBBNotFoundError) return [];
      throw err;
    }

    const items = coerceReferenceList(payload);
    if (items.length === 0) return [];

    const refs = items.map(parseReference);
    refs.sort((a, b) => {
      const aKey = (a.exercise_end ?? a.deposit_date ?? "") + (a.deposit_date ?? "");
      const bKey = (b.exercise_end ?? b.deposit_date ?? "") + (b.deposit_date ?? "");
      return bKey.localeCompare(aKey); // DESC
    });
    return deduplicate(refs);
  }

  async latestReferences(
    enterpriseNumber: string,
    limit = 2,
  ): Promise<FilingReference[]> {
    const refs = await this.listReferences(enterpriseNumber);
    return refs.slice(0, limit);
  }

  /**
   * Fetch the XBRL bytes for a filing, or null if absent.
   *
   * Three "not available" cases all surface as `null` (so the pipeline
   * falls through cleanly), each logged distinctly:
   *
   *   1. 404 from NBB.
   *   2. PDF returned for an XBRL request — subscription tier doesn't
   *      expose XBRL on this endpoint. The bytes start with `%PDF`
   *      instead of `<`.
   *   3. Unexpected content type.
   */
  async downloadXbrl(reference: string): Promise<Uint8Array | null> {
    let resp: Response;
    try {
      resp = await this.rawGet(
        this.depositPath.replace("{reference}", reference),
        { Accept: ACCEPT_XBRL },
      );
    } catch (err) {
      if (err instanceof NBBNotFoundError) {
        console.info(`XBRL not available for ${reference} (NBB returned 404)`);
        return null;
      }
      throw err;
    }

    const arrayBuf = await resp.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);
    const head = String.fromCharCode(...bytes.slice(0, 8));
    const contentType = resp.headers.get("content-type") ?? "";

    if (head.startsWith("%PDF")) {
      console.warn(
        `NBB ignored the XBRL Accept header for ${reference} and returned ` +
          `PDF (Content-Type: ${contentType}). Your subscription tier may ` +
          `not expose XBRL on this endpoint.`,
      );
      return null;
    }

    const trimmedHead = head.trimStart();
    if (!trimmedHead.startsWith("<") && !head.startsWith("﻿<")) {
      console.warn(
        `XBRL response for ${reference} does not look like XML ` +
          `(first 8 bytes: ${JSON.stringify(head)}, Content-Type: ${contentType}). ` +
          `Falling through.`,
      );
      return null;
    }

    return bytes;
  }

  /**
   * Fetch the PDF bytes for a filing, or null if absent.
   *
   * Mirrors {@link downloadXbrl} but requests the PDF representation
   * from the same content-negotiated deposit endpoint. The first 8
   * bytes are validated against the `%PDF` magic to catch tier-misconfig
   * cases (NBB occasionally serves an XBRL or HTML error page even
   * when PDF is requested).
   */
  async downloadPdf(reference: string): Promise<Uint8Array | null> {
    let resp: Response;
    try {
      resp = await this.rawGet(
        this.depositPath.replace("{reference}", reference),
        { Accept: ACCEPT_PDF },
      );
    } catch (err) {
      if (err instanceof NBBNotFoundError) {
        console.info(`PDF not available for ${reference} (NBB returned 404)`);
        return null;
      }
      throw err;
    }

    const arrayBuf = await resp.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);
    const head = String.fromCharCode(...bytes.slice(0, 8));
    const contentType = resp.headers.get("content-type") ?? "";

    if (!head.startsWith("%PDF")) {
      console.warn(
        `PDF response for ${reference} does not look like a PDF ` +
          `(first 8 bytes: ${JSON.stringify(head)}, Content-Type: ${contentType}). ` +
          `Falling through.`,
      );
      return null;
    }

    return bytes;
  }

  // ── private ──────────────────────────────────────────────────────────

  private async rawGet(
    path: string,
    extraHeaders: Record<string, string>,
  ): Promise<Response> {
    const url = this.baseUrl + path;
    const headers: Record<string, string> = {
      "NBB-CBSO-Subscription-Key": this.subscriptionKey,
      "X-Request-id": crypto.randomUUID(),
      "User-Agent": "legal-financial-enrichment/0.1",
      ...extraHeaders,
    };

    // Three-try exponential backoff matching the Python tenacity config
    // (multiplier=0.5, max=4 → 0.5s, 1s, then give up).
    const delays = [500, 1000];
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        let resp: Response;
        try {
          resp = await fetch(url, { headers, signal: controller.signal });
        } finally {
          clearTimeout(timeout);
        }
        if (resp.status === 404) {
          const body = await resp.text();
          throw new NBBNotFoundError(`NBB API 404 on ${path}: ${body.slice(0, 200)}`);
        }
        if (resp.status >= 400) {
          const body = await resp.text();
          throw new NBBClientError(
            `NBB API ${resp.status} on ${path}: ${body.slice(0, 200)}`,
          );
        }
        return resp;
      } catch (err) {
        // 404 and 4xx are terminal — don't retry, they aren't transient.
        if (err instanceof NBBNotFoundError) throw err;
        if (err instanceof NBBClientError) throw err;
        lastErr = err;
        if (attempt < delays.length) {
          await new Promise(r => setTimeout(r, delays[attempt]));
        }
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new NBBClientError(`NBB API request failed: ${String(lastErr)}`);
  }

  private async fetchJson(path: string): Promise<unknown> {
    const resp = await this.rawGet(path, { Accept: "application/json" });
    try {
      return await resp.json();
    } catch (err) {
      throw new NBBClientError(`Non-JSON response from ${path}`);
    }
  }
}
