/**
 * Server-side configuration, read once from environment.
 *
 * Mirrors backend/src/config.py. Every server module imports `env`
 * rather than reading `process.env` directly, so the surface is small
 * and we get a single boot-time validation point.
 *
 * Next.js exposes any `process.env.X` to server code at runtime; only
 * `NEXT_PUBLIC_*` is bundled into the client. None of these should be
 * `NEXT_PUBLIC_*`.
 */

export const env = {
  nbb: {
    baseUrl:
      process.env.NBB_API_BASE_URL ?? "https://ws.cbso.nbb.be/authentic",
    subscriptionKey: process.env.NBB_API_SUBSCRIPTION_KEY ?? "",
    depositPath:
      process.env.NBB_DEPOSIT_PATH ?? "/deposit/{reference}/accountingData",
  },
  http: {
    timeoutMs: Number(process.env.HTTP_TIMEOUT_MS ?? 30_000),
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  },
  /**
   * OpenRouter — unified gateway to many models (OpenAI, Anthropic,
   * Google, Meta, etc.). API is OpenAI-compatible, so we keep using
   * the openai SDK and just swap the `baseURL` + key + model name.
   *
   * When `OPENROUTER_API_KEY` is set, the LLM client prefers
   * OpenRouter over the direct OpenAI route. `OPENROUTER_MODEL`
   * uses the `<provider>/<model>` form, e.g.
   *   openai/gpt-4o-mini
   *   anthropic/claude-3.5-sonnet
   *   google/gemini-flash-1.5
   *
   * `appName` / `appUrl` populate the recommended `X-Title` and
   * `HTTP-Referer` headers — OpenRouter uses them for analytics
   * dashboards and per-app rate limiting. Both optional.
   */
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    baseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
    model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
    appName:
      process.env.OPENROUTER_APP_NAME ?? "legal-financial-enrichment",
    appUrl: process.env.OPENROUTER_APP_URL ?? "",
  },
  supabase: {
    url: process.env.SUPABASE_URL ?? "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  },
  apollo: {
    apiKey: process.env.APOLLO_API_KEY ?? "",
    baseUrl: process.env.APOLLO_API_BASE_URL ?? "https://api.apollo.io",
  },
  inpi: {
    /** Production base URL; override with INPI_API_BASE_URL to point at
     *  the pre-prod environment (registre-national-entreprises-pprod). */
    baseUrl:
      process.env.INPI_API_BASE_URL ??
      "https://registre-national-entreprises.inpi.fr",
    username: process.env.INPI_USERNAME ?? "",
    password: process.env.INPI_PASSWORD ?? "",
  },
} as const;

export const hasNbb = (): boolean => Boolean(env.nbb.subscriptionKey);
export const hasOpenAI = (): boolean => Boolean(env.openai.apiKey);
export const hasOpenRouter = (): boolean => Boolean(env.openrouter.apiKey);
/** Either provider is enough for the LLM-backed features. */
export const hasLlm = (): boolean => hasOpenRouter() || hasOpenAI();
export const hasSupabase = (): boolean =>
  Boolean(env.supabase.url && env.supabase.serviceRoleKey);
export const hasApollo = (): boolean => Boolean(env.apollo.apiKey);
export const hasInpi = (): boolean =>
  Boolean(env.inpi.username && env.inpi.password);
