/**
 * Unified company-identifier normaliser.
 *
 * Belgian CBE numbers are 10 digits (leading 0 or 1); French SIRENs
 * are 9 digits and pass a Luhn check. The two never overlap by
 * length, so we can deduce the country from the input shape and
 * normalise accordingly without an extra "which country?" parameter.
 */

import { tryNormalise as tryNormaliseCbe } from "./enterpriseNumber";
import { tryNormaliseSiren } from "./siren";
import type { Country } from "./models";

export type CompanyId = { id: string; country: Country };

export function tryNormaliseCompanyId(raw: string): CompanyId | null {
  const cbe = tryNormaliseCbe(raw);
  if (cbe !== null) return { id: cbe, country: "BE" };
  const siren = tryNormaliseSiren(raw);
  if (siren !== null) return { id: siren, country: "FR" };
  return null;
}

/** Convenience: just the normalised id, dropping the country. Use
 *  when the caller doesn't need to dispatch on country (e.g. cache
 *  lookups, where the country is read off the cached row). */
export function tryNormaliseAnyId(raw: string): string | null {
  return tryNormaliseCompanyId(raw)?.id ?? null;
}
