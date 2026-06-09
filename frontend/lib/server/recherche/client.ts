/**
 * Recherche d'entreprises — free public name search.
 *
 * Endpoint: `GET https://recherche-entreprises.api.gouv.fr/search`
 *   Docs: https://recherche-entreprises.api.gouv.fr/docs/
 *
 * Public + unauthenticated, so we don't carry a client class or any
 * token cache. Used by the French pipeline to resolve free-text names
 * to SIRENs before INPI's auth-gated bilans endpoint is called.
 *
 * The response surface is large; we parse only what we need
 * (siren / denomination / address) and tolerate missing fields. SIREN
 * searches (9 digits) and SIRET searches (14 digits) bypass filters
 * server-side, so the same endpoint handles "is this a number?"
 * disambiguation too — though for our flow that path is short-
 * circuited upstream by `tryNormaliseSiren`.
 */

import { createLogger } from "../log";

const log = createLogger("recherche");

const BASE_URL = "https://recherche-entreprises.api.gouv.fr/search";
const DEFAULT_TIMEOUT_MS = 10_000;

export class RechercheError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "RechercheError";
  }
}

export type RechercheCandidate = {
  siren: string;
  denomination: string;
  address: string | null;
};

/** Per-result shape coming back from the API. We're conservative
 *  about field presence — every field below is optional in practice. */
type RawResult = {
  siren?: string;
  nom_complet?: string | null;
  nom_raison_sociale?: string | null;
  siege?: {
    adresse?: string | null;
  } | null;
};

type RawResponse = {
  results?: RawResult[];
  total_results?: number;
  total_pages?: number;
};

export async function searchByName(
  name: string,
  opts?: { perPage?: number; timeoutMs?: number },
): Promise<RechercheCandidate[]> {
  // API caps per_page at 25; clamp the caller's value to that range.
  const perPage = Math.min(Math.max(opts?.perPage ?? 25, 1), 25);
  const params = new URLSearchParams({
    q: name,
    per_page: String(perPage),
  });

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  let resp: Response;
  try {
    resp = await fetch(`${BASE_URL}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) {
    throw new RechercheError(
      resp.status,
      `recherche-entreprises: HTTP ${resp.status}`,
    );
  }

  const body = (await resp.json()) as RawResponse;
  const results = body.results ?? [];
  log.info("searchByName", {
    name,
    total: body.total_results ?? results.length,
    returned: results.length,
  });

  return results
    .map(toCandidate)
    .filter((c): c is RechercheCandidate => c !== null);
}

function toCandidate(r: RawResult): RechercheCandidate | null {
  if (!r.siren || !/^\d{9}$/.test(r.siren)) return null;
  const denomination =
    (r.nom_complet?.trim() || r.nom_raison_sociale?.trim()) ?? null;
  if (!denomination) return null;
  const address = r.siege?.adresse?.trim() || null;
  return { siren: r.siren, denomination, address };
}
