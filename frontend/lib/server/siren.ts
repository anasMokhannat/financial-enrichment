/**
 * French SIREN helpers.
 *
 * A SIREN is a 9-digit company identifier issued by INSEE. Inputs in
 * the wild use spaces ("123 456 789") or no separators ("123456789").
 * SIRET (14 digits) is the SIREN plus a 5-digit establishment suffix;
 * we accept SIRETs as input too and trim them to the first 9 digits.
 *
 * Validation uses the Luhn check (modulo 10) that INSEE applies — same
 * algorithm as credit-card numbers. Common transcription mistakes
 * (swapped or dropped digits) are caught.
 */

const NON_DIGIT_RE = /\D/g;

export function normaliseSiren(raw: string): string {
  let digits = raw.replace(NON_DIGIT_RE, "");
  // Accept SIRET → first 9 digits = SIREN.
  if (digits.length === 14) digits = digits.slice(0, 9);
  if (digits.length !== 9) {
    throw new Error(
      `Not a valid SIREN (need 9 digits): ${JSON.stringify(raw)}`,
    );
  }
  if (!luhnOk(digits)) {
    throw new Error(`SIREN fails Luhn check: ${JSON.stringify(raw)}`);
  }
  return digits;
}

export function tryNormaliseSiren(raw: string): string | null {
  try {
    return normaliseSiren(raw);
  } catch {
    return null;
  }
}

/** Human display format: "123 456 789". */
export function formatSiren(siren: string): string {
  return `${siren.slice(0, 3)} ${siren.slice(3, 6)} ${siren.slice(6, 9)}`;
}

/**
 * Luhn check (modulo 10). Starting from the rightmost digit and moving
 * left, double every second digit; if doubling produces a two-digit
 * number, sum the digits. The total must be divisible by 10.
 */
function luhnOk(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}
