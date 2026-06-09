/**
 * Unified LLM client factory.
 *
 * Two providers are supported, both exposing the OpenAI Chat
 * Completions surface:
 *
 *   1. OpenRouter (preferred when configured) — unified gateway to
 *      Anthropic, Google, Meta, OpenAI, etc. Uses the same OpenAI SDK
 *      with a swapped `baseURL` + key. The selected model is whatever
 *      `OPENROUTER_MODEL` says (e.g. `anthropic/claude-3.5-sonnet`).
 *
 *   2. OpenAI direct — fallback when only `OPENAI_API_KEY` is set.
 *
 * Why one factory instead of two: the call sites (analyzer.ts,
 * extraction/pdf.ts) only need a configured `OpenAI` instance and a
 * model name. They don't care which provider stands behind it because
 * the request shape is identical — `chat.completions.create` with
 * `response_format: { type: "json_schema", … }`.
 *
 * If you switch `OPENROUTER_MODEL` to a model that doesn't support
 * strict json_schema (some non-OpenAI models), the structured-output
 * call will fail at the provider level. Pick a model that does:
 * OpenRouter's docs list compatibility under "Structured Outputs".
 */

import OpenAI from "openai";

import { env, hasOpenRouter } from "./config";

export type LlmClient = {
  /** OpenAI SDK instance — same surface regardless of provider. */
  client: OpenAI;
  /** Model identifier expected by `chat.completions.create({ model })`. */
  model: string;
  /** "openrouter" or "openai" — handy for log lines. */
  provider: "openrouter" | "openai";
};

export class LlmUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmUnavailableError";
  }
}

/**
 * Build the LLM client based on what's configured. Returns null when
 * neither provider has credentials — callers convert that to a 503.
 */
export function createLlmClient(): LlmClient | null {
  if (hasOpenRouter()) {
    return {
      client: new OpenAI({
        apiKey: env.openrouter.apiKey,
        baseURL: env.openrouter.baseUrl,
        defaultHeaders: openRouterHeaders(),
      }),
      model: env.openrouter.model,
      provider: "openrouter",
    };
  }
  if (env.openai.apiKey) {
    return {
      client: new OpenAI({ apiKey: env.openai.apiKey }),
      model: env.openai.model,
      provider: "openai",
    };
  }
  return null;
}

/**
 * Variant that throws instead of returning null — for call sites that
 * already validated configuration upstream and want a non-nullable
 * client without an extra null check.
 */
export function createLlmClientOrThrow(): LlmClient {
  const client = createLlmClient();
  if (client === null) {
    throw new LlmUnavailableError(
      "No LLM provider configured. Set OPENROUTER_API_KEY or OPENAI_API_KEY.",
    );
  }
  return client;
}

function openRouterHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Title": env.openrouter.appName,
  };
  if (env.openrouter.appUrl) {
    headers["HTTP-Referer"] = env.openrouter.appUrl;
  }
  return headers;
}
