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
  supabase: {
    url: process.env.SUPABASE_URL ?? "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  },
} as const;

export const hasNbb = (): boolean => Boolean(env.nbb.subscriptionKey);
export const hasOpenAI = (): boolean => Boolean(env.openai.apiKey);
export const hasSupabase = (): boolean =>
  Boolean(env.supabase.url && env.supabase.serviceRoleKey);
