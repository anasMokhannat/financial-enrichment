/**
 * INPI (French Registre National des Entreprises) HTTP client.
 *
 * Docs: "Accéder aux comptes annuels PDF et saisis associés à une
 * entreprise" v5 (June 2025) — endpoints used here:
 *   POST /api/sso/login                          → auth, returns bearer token
 *   GET  /api/companies/{siren}/attachments      → list bilans + bilans-saisis
 *   GET  /api/bilans-saisis/{id}                 → structured cerfa-coded data
 *   GET  /api/bilans/{id}/download               → original PDF
 *
 * The token is cached in-process for slightly under its TTL (the doc
 * doesn't specify, so we conservatively re-auth every 25 minutes). On
 * 401 we drop the cache and retry once.
 */

import { env, hasInpi } from "../config";
import { createLogger } from "../log";

const log = createLogger("inpi");

const TOKEN_TTL_MS = 25 * 60 * 1000; // 25 minutes
const DEFAULT_TIMEOUT_MS = 30_000;

export class InpiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "InpiError";
  }
}

export class InpiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InpiUnavailableError";
  }
}

// ── Response shapes (subset of what INPI returns) ────────────────────────

export type InpiBilanRef = {
  /** Document identifier — used by /api/bilans/{id} + /download. */
  id: string;
  siren: string;
  denomination: string | null;
  dateDepot: string | null; // YYYY-MM-DD
  dateCloture: string | null; // YYYY-MM-DD
  numChrono: string | null;
  nomDocument: string | null;
  confidentiality: string | null;
  deleted: boolean;
  /** "C", "S", "K", "B", "AS", "AC", "ASS"… */
  typeBilan: string | null;
  version: string | null;
  createdAt?: string;
};

export type InpiLiasse = {
  code: string;
  m1: string;
  m2: string;
  m3: string;
  m4: string;
};

export type InpiBilanPage = {
  numero: number;
  liasses: InpiLiasse[];
};

export type InpiBilanSaisi = {
  identite: {
    siren: string;
    dateClotureExercice: string | null;
    codeGreffe: string | null;
    numDepot: string | null;
    numGestion: string | null;
    codeActivite: string | null;
    dateClotureExerciceNMoins1: string | null;
    dureeExerciceN: string | null;
    dureeExerciceNMoins1: string | null;
    dateDepot: string | null;
    codeSaisie: string | null;
    codeTypeBilan: string | null;
    codeDevise: string | null;
    codeOrigineDevise: string | null;
    codeConfidentialite: string | null;
    infoTraitement: string | null;
    denomination: string | null;
    adresse: string | null;
  };
  detail?: {
    pages: InpiBilanPage[];
  };
};

export type InpiBilanSaisiResponse = {
  id: string;
  siren: string;
  denomination: string | null;
  dateDepot: string | null;
  dateCloture: string | null;
  confidentiality: string | null;
  deleted: boolean;
  bilanSaisi: { bilan: InpiBilanSaisi };
  version: string | null;
};

export type InpiAttachments = {
  actes: unknown[];
  bilans: InpiBilanRef[];
  /** Each entry also includes the inline saisi blob; we don't need it
   *  here because we fetch the standalone /bilans-saisis/{id} endpoint
   *  for cleaner parsing. Just keep the metadata shape. */
  bilansSaisis: InpiBilanRef[];
};


// ── Client ───────────────────────────────────────────────────────────────

export class InpiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly timeoutMs: number;
  private tokenCache: { token: string; fetchedAt: number } | null = null;

  constructor(opts?: { fetchImpl?: typeof fetch; timeoutMs?: number }) {
    this.fetchImpl = opts?.fetchImpl ?? fetch;
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.baseUrl = env.inpi.baseUrl.replace(/\/+$/, "");
    this.username = env.inpi.username;
    this.password = env.inpi.password;
  }

  /** Returns null when INPI isn't configured; callers must check. */
  static create(): InpiClient | null {
    if (!hasInpi()) return null;
    return new InpiClient();
  }

  // ── auth ───────────────────────────────────────────────────────────────

  private async getToken(force = false): Promise<string> {
    const now = Date.now();
    if (
      !force &&
      this.tokenCache !== null &&
      now - this.tokenCache.fetchedAt < TOKEN_TTL_MS
    ) {
      return this.tokenCache.token;
    }
    if (!this.username || !this.password) {
      throw new InpiUnavailableError(
        "INPI credentials not configured (INPI_USERNAME / INPI_PASSWORD).",
      );
    }
    const url = `${this.baseUrl}/api/sso/login`;
    const resp = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: this.username,
        password: this.password,
      }),
    });
    if (!resp.ok) {
      throw new InpiError(resp.status, `INPI login failed: HTTP ${resp.status}`);
    }
    const body = (await resp.json()) as { token?: string };
    if (!body.token) {
      throw new InpiError(500, "INPI login returned no token.");
    }
    this.tokenCache = { token: body.token, fetchedAt: now };
    log.info("login ok", { ttlMs: TOKEN_TTL_MS });
    return body.token;
  }

  // ── public endpoints ───────────────────────────────────────────────────

  async getAttachments(siren: string): Promise<InpiAttachments> {
    const path = `/api/companies/${encodeURIComponent(siren)}/attachments`;
    return this.authedJson<InpiAttachments>(path);
  }


  async getBilanSaisi(id: string): Promise<InpiBilanSaisiResponse> {
    const path = `/api/bilans-saisis/${encodeURIComponent(id)}`;
    return this.authedJson<InpiBilanSaisiResponse>(path);
  }

  async getBilanMetadata(id: string): Promise<InpiBilanRef> {
    const path = `/api/bilans/${encodeURIComponent(id)}`;
    return this.authedJson<InpiBilanRef>(path);
  }

  /** Returns null on 404 (PDF deleted by INPI / not available). */
  async downloadBilanPdf(id: string): Promise<Uint8Array | null> {
    const path = `/api/bilans/${encodeURIComponent(id)}/download`;
    const resp = await this.authedRequest(path);
    if (resp.status === 404) return null;
    if (!resp.ok) {
      throw new InpiError(resp.status, `INPI download ${id}: HTTP ${resp.status}`);
    }
    const buf = await resp.arrayBuffer();
    return new Uint8Array(buf);
  }

  // ── lower-level helpers ────────────────────────────────────────────────

  private async authedJson<T>(path: string): Promise<T> {
    const resp = await this.authedRequest(path);
    if (!resp.ok) {
      throw new InpiError(resp.status, `INPI ${path}: HTTP ${resp.status}`);
    }
    return (await resp.json()) as T;
  }

  /** Authed GET with one automatic retry on 401 (token may have expired). */
  private async authedRequest(path: string): Promise<Response> {
    let token = await this.getToken();
    let resp = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.status === 401) {
      log.info("401 — refreshing token");
      token = await this.getToken(true);
      resp = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    return resp;
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }
}

