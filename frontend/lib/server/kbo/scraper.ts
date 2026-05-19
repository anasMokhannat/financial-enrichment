/**
 * Scraper for KBO/CBE public search (kbopub.economie.fgov.be).
 *
 * Port of backend/src/kbo/scraper.py — the KBO public search has no
 * JSON API, so we submit the phonetic name search form, parse the
 * result list with cheerio, then fetch the company detail page for
 * canonical fields.
 *
 * Reuse of CBE data is restricted: this module does targeted,
 * single-entity lookups on demand and is not suitable for bulk
 * scraping. Use the official monthly CSV extracts for bulk needs.
 */

import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";

// cheerio doesn't re-export AnyNode at the package root; rather than
// drill into its internals, we accept any DOM-ish value that $() will
// happily wrap. Every callsite immediately calls $(node) so a precise
// type buys nothing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DomNode = any;

import {
  AmbiguousMatchError,
  KBOScraperError,
} from "../errors";
import {
  formatHuman,
  normalise as normaliseEnterpriseNumber,
  tryNormalise as tryNormaliseEnterpriseNumber,
} from "../enterpriseNumber";
import { Company, type Func, type NaceCode } from "../models";

const KBO_BASE = "https://kbopub.economie.fgov.be/kbopub";
const SEARCH_BY_NAME = `${KBO_BASE}/zoeknaamfonetischform.html`;
const DETAIL_BY_NUMBER = `${KBO_BASE}/toonondernemingps.html`;

const ENTERPRISE_NUMBER_RE = /\b([01]\d{3}[.\s]?\d{3}[.\s]?\d{3})\b/;
const ENTERPRISE_NUMBER_FULL = /^[01]\d{3}[.\s]?\d{3}[.\s]?\d{3}$/;

const NACE_CODE_RE = /\b(\d{2}\.\d{1,3}(?:\.\d{1,3})?)\b/;

const NACE_HEADER_RE =
  /Nacebel codes for the (VAT|NSSO|EDRL) activities\s+(\d{4})/i;

const SINCE_RE = /(?:Since|Sinds|Depuis(?:\s+le)?)\s+(.+?)(?:\s*$|\s{2,})/i;

const BE_POSTCODE_RE =
  /\b\d{4}\b\s+[A-ZÉÈÀÂÄÔÖÙÛÇa-zéèàâäôöùûç][^,]*/;

const NAME_METADATA_TAIL =
  /\s+(?:Name\s+(?:in|en|au)\b|Nom\s+(?:en|au)\b|Naam\s+(?:in|als)\b|since\s+\w+|depuis\s+(?:le\s+)?\w+|sinds\s+\d|\(?in\s+\w+\s+language\b)/i;

const DATE_FORMATS: Array<(s: string) => string | null> = [
  // DD.MM.YYYY
  (s) => {
    const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  },
  // DD/MM/YYYY
  (s) => {
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  },
  // YYYY-MM-DD
  (s) => {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  },
  // "Month DD, YYYY" / "Mon DD, YYYY"
  (s) => {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    if (y < 1900 || y > 2100) return null;
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  },
];

function parseDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  for (const parser of DATE_FORMATS) {
    const out = parser(trimmed);
    if (out) return out;
  }
  return null;
}

type Section = "general" | "functions" | "characteristics" | "authorisations" | "nace" | "other";

const SECTION_MATCHERS: Array<[Section, RegExp]> = [
  ["general", /^In general\b/i],
  ["functions", /^Functions\b/i],
  ["characteristics", /^Characteristics\b/i],
  ["authorisations", /^Authorisations?\b/i],
];

export type KBOCandidate = {
  enterprise_number: string;
  name: string;
  address: string | null;
};

function rowText($: CheerioAPI, row: DomNode): string {
  return $(row).text().replace(/\s+/g, " ").trim();
}

function cellText($: CheerioAPI, cell: DomNode): string {
  return $(cell).text().replace(/\s+/g, " ").trim();
}

export class KBOScraper {
  private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(opts?: { fetchImpl?: typeof fetch; timeoutMs?: number }) {
    this.fetchImpl = opts?.fetchImpl ?? fetch;
    this.timeoutMs = opts?.timeoutMs ?? 30_000;
    this.headers = {
      "User-Agent":
        "Mozilla/5.0 (compatible; legal-financial-enrichment/0.1; targeted CBE lookup)",
      "Accept-Language": "en,fr;q=0.8,nl;q=0.7",
    };
  }

  /** Resolve `query` (name or 10-digit number) to a Company. */
  async lookup(query: string): Promise<Company> {
    const q = query.trim();
    if (!q) throw new KBOScraperError("Empty query");

    const direct = tryNormaliseEnterpriseNumber(q);
    const number = direct ?? (await this.searchByName(q));
    return this.fetchDetail(number);
  }

  /** List of plausible matches for a free-text name. Does not throw on >1 hit. */
  async searchCandidates(name: string): Promise<KBOCandidate[]> {
    const html = await this.fetchSearchByName(name);
    return this.parseCandidates(html);
  }

  // ── private ──────────────────────────────────────────────────────────

  private async searchByName(name: string): Promise<string> {
    const html = await this.fetchSearchByName(name);
    const candidates = this.parseCandidates(html);
    if (candidates.length === 0) {
      throw new KBOScraperError(`No KBO match for ${JSON.stringify(name)}`);
    }

    const lower = name.toLowerCase();
    const exact = candidates.filter((c) => c.name.toLowerCase() === lower);
    if (exact.length === 1) return exact[0].enterprise_number;
    if (candidates.length === 1) return candidates[0].enterprise_number;

    throw new AmbiguousMatchError(
      candidates.slice(0, 25),
      `${candidates.length} KBO matches for ${JSON.stringify(name)}; refine the query.`,
    );
  }

  private async fetchSearchByName(name: string): Promise<string> {
    const params = new URLSearchParams({
      searchWord: name,
      _oudeBenaming: "on",
      pstcdeNPRP: "",
      postgemeente1: "",
      ondNP: "true",
      _ondNP: "on",
      ondRP: "true",
      _ondRP: "on",
      rechtsvormFonetic: "ALL",
      vest: "true",
      _vest: "on",
      filterEnkelActieve: "true",
      _filterEnkelActieve: "on",
      actionNPRP: "Rechercher",
    });
    return this.getText(`${SEARCH_BY_NAME}?${params.toString()}`);
  }

  private parseCandidates(html: string): KBOCandidate[] {
    const $ = cheerio.load(html);
    const seen = new Map<string, KBOCandidate>();

    $("tr").each((_i, row) => {
      const cells = $(row)
        .find("td")
        .toArray()
        .map((c) => cellText($, c));
      if (cells.length < 2) return;
      const joined = cells.join(" ");
      const numMatch = joined.match(ENTERPRISE_NUMBER_RE);
      if (!numMatch) return;
      const number = tryNormaliseEnterpriseNumber(numMatch[1]);
      if (!number) return;

      let nameCell = "";
      let addressCell: string | null = null;
      for (const c of cells) {
        if (!c || ENTERPRISE_NUMBER_FULL.test(c)) continue;
        if (!nameCell) {
          nameCell = c;
          continue;
        }
        if (addressCell === null && BE_POSTCODE_RE.test(c)) {
          addressCell = c.trim();
          break;
        }
      }
      if (!seen.has(number)) {
        seen.set(number, {
          enterprise_number: number,
          name: nameCell,
          address: addressCell,
        });
      }
    });

    if (seen.size > 0) return Array.from(seen.values());

    // Fallback: scan anchor hrefs for ondernemingsnummer query params.
    $("a[href]").each((_i, link) => {
      const href = $(link).attr("href") ?? "";
      if (!href.includes("ondernemingsnummer=")) return;
      const numMatch = href.replace(/=/g, " ").match(ENTERPRISE_NUMBER_RE);
      if (!numMatch) return;
      const number = tryNormaliseEnterpriseNumber(numMatch[1]);
      if (!number) return;
      if (!seen.has(number)) {
        seen.set(number, {
          enterprise_number: number,
          name: $(link).text().trim(),
          address: null,
        });
      }
    });
    return Array.from(seen.values());
  }

  private async fetchDetail(enterpriseNumber: string): Promise<Company> {
    const params = new URLSearchParams({
      lang: "en",
      ondernemingsnummer: enterpriseNumber,
    });
    const html = await this.getText(`${DETAIL_BY_NUMBER}?${params.toString()}`);
    const lowered = html.toLowerCase();
    if (lowered.includes("not registered") || lowered.includes("geen onderneming")) {
      throw new KBOScraperError(
        `Enterprise number ${formatHuman(enterpriseNumber)} not found.`,
      );
    }
    return this.parseDetail(enterpriseNumber, html);
  }

  private parseDetail(enterpriseNumber: string, html: string): Company {
    const $ = cheerio.load(html);
    const sections = this.collectSections($);

    const generalPairs = sections.general;
    const rawName =
      generalPairs.get("name") ??
      generalPairs.get("denomination") ??
      firstHeadingName($) ??
      formatHuman(enterpriseNumber);
    const name = cleanCompanyName(rawName);

    const statusText = generalPairs.get("status") ?? "";
    const dissolutionDate = detectDissolution(statusText, generalPairs);
    const vatSubject = detectVatSubject(sections.characteristics);

    return Company.parse({
      enterprise_number: enterpriseNumber,
      name,
      trade_name:
        generalPairs.get("name in another language") ??
        generalPairs.get("commercial name") ??
        null,
      legal_form:
        generalPairs.get("legal form") ?? generalPairs.get("juridische vorm") ?? null,
      address:
        generalPairs.get("address of the registered office") ??
        generalPairs.get("address") ??
        generalPairs.get("adres") ??
        null,
      status: statusText || null,
      start_date: parseDate(
        generalPairs.get("start date") ?? generalPairs.get("startdatum") ?? "",
      ),
      dissolution_date: dissolutionDate,
      vat_subject: vatSubject,
      nace_codes: sections.nace,
      functions: sections.functions,
    });
  }

  /**
   * Walk every row once, dispatching to the right section parser.
   *
   * KBO pages use one giant flat table with section-header rows
   * interleaved with data rows, so we do a single linear pass and
   * track the current section.
   */
  private collectSections($: CheerioAPI): {
    general: Map<string, string>;
    characteristics: string[];
    authorisations: string[];
    nace: NaceCode[];
    functions: Func[];
  } {
    const general = new Map<string, string>();
    const characteristics: string[] = [];
    const authorisations: string[] = [];
    const nace: NaceCode[] = [];
    const functions: Func[] = [];

    let current: Section = "other";
    let naceSource: string | null = null;
    let naceVersion: number | null = null;

    $("tr").each((_i, row) => {
      const cells = $(row).find("td").toArray();
      if (cells.length === 0) return;
      const text = rowText($, row);

      const header = matchSectionHeader(text);
      if (header !== null) {
        current = header.section;
        naceSource = header.source;
        naceVersion = header.version;
        return;
      }

      if (current === "general" && cells.length >= 2) {
        const label = cellText($, cells[0])
          .replace(/:$/, "")
          .toLowerCase();
        const value = cellText($, cells[1]);
        if (label && value && !general.has(label)) {
          general.set(label, value);
        }
      } else if (current === "characteristics") {
        if (text) characteristics.push(text);
      } else if (current === "authorisations") {
        if (text) authorisations.push(text);
      } else if (current === "nace") {
        const code = parseNaceRow(text, naceSource, naceVersion);
        if (code !== null) nace.push(code);
      } else if (current === "functions") {
        const func = parseFunctionRow(
          cells.map((c) => cellText($, c)),
          text,
        );
        if (func !== null) functions.push(func);
      }
    });

    return { general, characteristics, authorisations, nace, functions };
  }

  private async getText(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const resp = await this.fetchImpl(url, {
        headers: this.headers,
        signal: controller.signal,
        redirect: "follow",
      });
      if (!resp.ok) {
        throw new KBOScraperError(`KBO ${resp.status} on ${url}`);
      }
      return await resp.text();
    } finally {
      clearTimeout(timeout);
    }
  }
}

// ── module-level helpers (testable in isolation) ─────────────────────

function firstHeadingName($: CheerioAPI): string | null {
  for (const tag of ["h1", "h2", "h3"]) {
    const node = $(tag).first();
    if (node.length > 0) {
      const text = node.text().trim();
      if (text) return text;
    }
  }
  return null;
}

function matchSectionHeader(
  text: string,
): { section: Section; source: string | null; version: number | null } | null {
  const naceMatch = text.match(NACE_HEADER_RE);
  if (naceMatch) {
    return {
      section: "nace",
      source: naceMatch[1].toUpperCase(),
      version: Number(naceMatch[2]),
    };
  }
  for (const [section, pattern] of SECTION_MATCHERS) {
    if (pattern.test(text)) {
      return { section, source: null, version: null };
    }
  }
  return null;
}

function parseNaceRow(
  text: string,
  sectionSource: string | null,
  sectionVersion: number | null,
): NaceCode | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const codeMatch = trimmed.match(NACE_CODE_RE);
  if (!codeMatch || codeMatch.index === undefined) return null;
  const code = codeMatch[1];

  let source = sectionSource;
  let version = sectionVersion;
  const prefix = trimmed.slice(0, codeMatch.index).trim();
  const prefixMatch = prefix.match(/^(VAT|NSSO|EDRL)\s+(\d{4})/i);
  if (prefixMatch) {
    source = prefixMatch[1].toUpperCase();
    version = Number(prefixMatch[2]);
  }

  const rest = trimmed.slice(codeMatch.index + code.length).replace(/^[\s\-–:]+/, "").trim();
  let description: string = rest;
  let since: string | null = null;
  const sinceMatch = rest.match(SINCE_RE);
  if (sinceMatch && sinceMatch.index !== undefined) {
    description = rest.slice(0, sinceMatch.index).replace(/[\s\-–]+$/, "");
    since = parseDate(sinceMatch[1]);
  }

  return {
    code,
    description: description || null,
    source,
    version,
    since,
  };
}

function parseFunctionRow(cellTexts: string[], rowText: string): Func | null {
  let text = rowText.trim();
  if (!text) return null;

  let since: string | null = null;
  const sinceMatch = text.match(SINCE_RE);
  if (sinceMatch && sinceMatch.index !== undefined) {
    since = parseDate(sinceMatch[1]);
    text = text.slice(0, sinceMatch.index).replace(/[\s,\-–]+$/, "");
  }

  let holderEnterpriseNumber: string | null = null;
  const numMatch = text.match(ENTERPRISE_NUMBER_RE);
  if (numMatch && numMatch.index !== undefined) {
    const candidate = tryNormaliseEnterpriseNumber(numMatch[1]);
    if (candidate) holderEnterpriseNumber = candidate;
    text =
      (text.slice(0, numMatch.index) + text.slice(numMatch.index + numMatch[1].length))
        .trim()
        .replace(/^[\s,\-–]+|[\s,\-–]+$/g, "");
  }

  const role = (cellTexts[0] ?? "").replace(/:$/, "").trim();
  let holderName: string | null = null;
  if (role && text.toLowerCase().startsWith(role.toLowerCase())) {
    holderName = text.slice(role.length).replace(/^[\s,\-–:]+/, "").trim() || null;
  } else if (role && text) {
    holderName = text.replace(role, "").replace(/^[\s,\-–:]+|[\s,\-–:]+$/g, "").trim() || null;
  } else {
    holderName = text || null;
  }

  if (!role && !holderName) return null;
  return {
    role: role || "Unknown",
    holder_name: holderName,
    holder_enterprise_number: holderEnterpriseNumber,
    since,
  };
}

function detectVatSubject(characteristics: string[]): boolean | null {
  if (characteristics.length === 0) return null;
  for (const line of characteristics) {
    const l = line.toLowerCase();
    if (
      l.includes("subject to vat") ||
      l.includes("btw-plichtig") ||
      l.includes("assujetti à la tva")
    ) {
      return true;
    }
  }
  const anyVat = characteristics.some((line) => {
    const l = line.toLowerCase();
    return l.includes("vat") || l.includes("btw") || l.includes("tva");
  });
  return anyVat ? false : null;
}

function cleanCompanyName(raw: string): string {
  if (!raw) return raw;
  let cleaned = raw.trim();
  const match = cleaned.match(NAME_METADATA_TAIL);
  if (match && match.index !== undefined) {
    cleaned = cleaned.slice(0, match.index).trim();
  }
  return cleaned.replace(/:$/, "").trim();
}

function detectDissolution(
  status: string,
  general: Map<string, string>,
): string | null {
  const endFallback =
    parseDate(general.get("end date") ?? general.get("einddatum") ?? "");
  if (!status) return endFallback;
  const lowered = status.toLowerCase();
  const matchesMarker = ["dissol", "stopgezet", "cessation", "liquidat"].some((m) =>
    lowered.includes(m),
  );
  if (!matchesMarker) return endFallback;
  const sinceMatch = status.match(SINCE_RE);
  if (sinceMatch) {
    const parsed = parseDate(sinceMatch[1]);
    if (parsed) return parsed;
  }
  return endFallback;
}

// Expose the small pure helpers for unit-testing.
export const _testing = {
  parseDate,
  parseNaceRow,
  parseFunctionRow,
  cleanCompanyName,
  detectVatSubject,
  detectDissolution,
  matchSectionHeader,
};
