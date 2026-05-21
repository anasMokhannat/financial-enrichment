/**
 * Apollo.io People Enrichment client.
 *
 * Wraps the POST /api/v1/people/match endpoint. Given a person's name
 * (and optionally the company they work at), returns the best-matching
 * Apollo person record — including a verified business email when
 * Apollo has one on file.
 *
 * Docs: https://docs.apollo.io/reference/people-enrichment
 *
 * The API key lives in process.env.APOLLO_API_KEY and is never exposed
 * to the browser. This module is server-only — import only from Route
 * Handlers and Server Components.
 */

import { env, hasApollo } from "../config";
import { createLogger } from "../log";

const log = createLogger("apollo");

const MATCH_PATH = "/api/v1/people/match";

export class ApolloError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApolloError";
    this.status = status;
  }
}

export type EnrichInput = {
  /** Full display name as it appears in KBO (e.g. "Jan Van Den Berge"). */
  fullName: string;
  /** Company name (e.g. "Flugia BV"). Greatly improves match quality. */
  companyName?: string | null;
  /** Optional company website domain. Highest-signal field for Apollo. */
  domain?: string | null;
};

export type EnrichResult = {
  /** True when Apollo found a match for the input. */
  matched: boolean;
  /** Verified business email, when present. May be null even on a match. */
  email: string | null;
  /** Normalised name as Apollo has it. */
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  /** Job title at the matched company. */
  title: string | null;
  linkedin_url: string | null;
  /** Public photo URL Apollo serves. Handy for the UI avatar. */
  photo_url: string | null;
  /** Apollo's matched organisation name (may differ slightly from input). */
  organization_name: string | null;
};

/**
 * Common titles / salutations that prefix names. Stripped before
 * splitting. Case-insensitive, requires trailing whitespace so we don't
 * eat the start of an actual name (e.g. "Drew" must not lose "Dr").
 */
const TITLE_PREFIX_RE =
  /^(?:mr\.?|mrs\.?|ms\.?|mlle\.?|mme\.?|dr\.?|drs\.?|prof\.?|ir\.?|ing\.?|meneer|mevrouw|monsieur|madame)\s+/i;

/**
 * Strip noise from a raw KBO name before it goes to Apollo.
 *
 * Handles:
 *   - "VAN DAMME, JEAN-CLAUDE"  → "JEAN-CLAUDE VAN DAMME"
 *     (Belgian/Anglo "Last, First" format — flip on the first comma)
 *   - "  Jan  De   Wit  "       → "Jan De Wit"
 *     (collapse internal whitespace)
 *   - "Mr. Jan De Wit"          → "Jan De Wit"
 *     (strip leading title)
 *   - "Jan De Wit,"             → "Jan De Wit"
 *     (trim trailing punctuation)
 *   - "Jan; De Wit"             → "Jan De Wit"
 *     (replace stray separators with space)
 *
 * Apostrophes (`D'Hondt`) and hyphens (`Jean-Claude`) inside names are
 * preserved.
 */
export function cleanName(raw: string): string {
  let name = (raw ?? "").trim();
  if (!name) return "";

  // Drop zero-width / BOM chars (U+200B-U+200D, U+FEFF) — KBO
  // occasionally embeds these in HTML-decoded text.
  name = name.replace(/[​-‍﻿]/g, "");

  // Collapse internal whitespace before the comma check so multi-space
  // gaps don't confuse the surname-first detection.
  name = name.replace(/\s+/g, " ").trim();

  // Strip a leading salutation if present (repeatedly, in case of
  // pathological "Mr. Dr. Jan").
  while (TITLE_PREFIX_RE.test(name)) {
    name = name.replace(TITLE_PREFIX_RE, "");
  }

  // "LAST, FIRST" → "FIRST LAST". Only flip on the first comma; any
  // remaining commas (suffixes like ", Jr.") are stripped below.
  const commaIdx = name.indexOf(",");
  if (commaIdx > 0) {
    const left = name.slice(0, commaIdx).trim();
    const right = name.slice(commaIdx + 1).trim();
    if (left && right) {
      name = `${right} ${left}`;
    }
  }

  // Replace remaining comma / semicolon / pipe separators with space.
  name = name.replace(/[,;|]+/g, " ");
  // Collapse whitespace again after substitutions.
  name = name.replace(/\s+/g, " ").trim();

  // Trim leading/trailing characters that aren't letters, apostrophes,
  // or hyphens. Preserves intra-name punctuation like "D'Hondt".
  name = name.replace(/^[^\p{L}'-]+|[^\p{L}'-]+$/gu, "");

  return name;
}

/**
 * Split a full name into first / last components.
 *
 * Heuristic: first whitespace-separated token is the first name, the
 * remainder is the last name. KBO renders Belgian names as
 * "FIRSTNAME LASTNAME" or "FIRSTNAME VAN DEN LASTNAME" — both work
 * with this split because Apollo treats compound surnames as a single
 * `last_name` field.
 *
 * Runs `cleanName` first so stray commas / titles / whitespace from
 * the KBO scrape don't reach Apollo.
 */
export function splitName(full: string): {
  firstName: string;
  lastName: string;
} {
  const cleaned = cleanName(full);
  if (!cleaned) return { firstName: "", lastName: "" };
  const idx = cleaned.indexOf(" ");
  if (idx === -1) return { firstName: cleaned, lastName: "" };
  return {
    firstName: cleaned.slice(0, idx),
    lastName: cleaned.slice(idx + 1),
  };
}

export class ApolloClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts?: { apiKey?: string; baseUrl?: string }) {
    const apiKey = opts?.apiKey ?? env.apollo.apiKey;
    if (!apiKey) {
      throw new ApolloError(
        "APOLLO_API_KEY is not set; the Apollo client requires a key.",
        503,
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = (opts?.baseUrl ?? env.apollo.baseUrl).replace(/\/$/, "");
  }

  static create(): ApolloClient | null {
    if (!hasApollo()) return null;
    return new ApolloClient();
  }

  async enrich(input: EnrichInput): Promise<EnrichResult> {
    const { firstName, lastName } = splitName(input.fullName);
    if (!firstName) {
      throw new ApolloError("Cannot enrich an empty name.", 400);
    }

    // Apollo's match endpoint takes either first/last + organization,
    // or domain, or email, or linkedin_url. We pass first/last +
    // organization_name (most-specific signal we have from KBO) and
    // include domain when caller supplied one.
    const body: Record<string, unknown> = {
      first_name: firstName,
      last_name: lastName,
      reveal_personal_emails: false,
      reveal_phone_number: false,
    };
    if (input.companyName) body.organization_name = input.companyName;
    if (input.domain) body.domain = input.domain;

    const url = this.baseUrl + MATCH_PATH;
    log.info("enrich request", {
      firstName,
      lastName,
      companyName: input.companyName ?? null,
      domain: input.domain ?? null,
    });
    const t0 = performance.now();

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Cache-Control": "no-cache",
          // Apollo's canonical auth header. They previously documented
          // `Api-Key`; new accounts use `x-api-key`.
          "x-api-key": this.apiKey,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn("enrich network error", { error: message });
      throw new ApolloError(`Apollo request failed: ${message}`, 502);
    }

    const ms = Math.round(performance.now() - t0);

    if (resp.status === 401 || resp.status === 403) {
      log.warn("enrich auth failed", { status: resp.status, ms });
      throw new ApolloError(
        "Apollo rejected the API key (401/403). Check APOLLO_API_KEY.",
        resp.status,
      );
    }
    if (resp.status === 429) {
      log.warn("enrich rate limited", { ms });
      throw new ApolloError("Apollo rate limit hit. Retry later.", 429);
    }
    if (resp.status >= 400) {
      const text = await resp.text();
      log.warn("enrich upstream error", {
        status: resp.status,
        body: text.slice(0, 200),
        ms,
      });
      throw new ApolloError(
        `Apollo returned ${resp.status}: ${text.slice(0, 200)}`,
        resp.status >= 500 ? 502 : resp.status,
      );
    }

    const payload = (await resp.json()) as ApolloMatchResponse;
    const person = payload.person ?? null;

    if (!person) {
      log.info("enrich no match", { ms });
      return emptyResult();
    }

    const result: EnrichResult = {
      matched: true,
      email: extractEmail(person),
      name: person.name ?? null,
      first_name: person.first_name ?? null,
      last_name: person.last_name ?? null,
      title: person.title ?? null,
      linkedin_url: person.linkedin_url ?? null,
      photo_url: person.photo_url ?? null,
      organization_name: person.organization?.name ?? null,
    };
    log.info("enrich match", {
      ms,
      hasEmail: result.email !== null,
      title: result.title,
      organization: result.organization_name,
    });
    return result;
  }
}

function emptyResult(): EnrichResult {
  return {
    matched: false,
    email: null,
    name: null,
    first_name: null,
    last_name: null,
    title: null,
    linkedin_url: null,
    photo_url: null,
    organization_name: null,
  };
}

/**
 * Pick the best email from Apollo's possibly-multiple email fields.
 *
 * Apollo's response carries `email` (top-level), `personal_emails[]`,
 * and `organization?.primary_domain`. We prefer the top-level business
 * email and fall back to nothing — the caller asked Apollo NOT to
 * reveal personal emails, so we don't surface those either way.
 *
 * `email_status` of "unverified" still gets surfaced; the UI decides
 * whether to show it differently.
 */
function extractEmail(person: ApolloPerson): string | null {
  if (typeof person.email === "string" && person.email.includes("@")) {
    return person.email;
  }
  return null;
}

// ── Apollo response shape (only the fields we read) ────────────────────

type ApolloMatchResponse = {
  person?: ApolloPerson | null;
};

type ApolloPerson = {
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  email_status?: string;
  linkedin_url?: string;
  photo_url?: string;
  organization?: { name?: string; primary_domain?: string };
};
