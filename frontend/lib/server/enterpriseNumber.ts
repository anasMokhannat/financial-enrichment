/**
 * Belgian enterprise (BCE/KBO/CBE) number helpers.
 *
 * Port of backend/src/_enterprise_number.py. An enterprise number is
 * 10 digits with a leading 0 or 1; inputs in the wild use dots, spaces,
 * or nothing as separators.
 */

const NON_DIGIT_RE = /\D/g;

export function normalise(raw: string): string {
  const digits = raw.replace(NON_DIGIT_RE, "");
  if (digits.length !== 10 || (digits[0] !== "0" && digits[0] !== "1")) {
    throw new Error(`Not a valid Belgian enterprise number: ${JSON.stringify(raw)}`);
  }
  return digits;
}

export function tryNormalise(raw: string): string | null {
  try {
    return normalise(raw);
  } catch {
    return null;
  }
}

export function formatHuman(number: string): string {
  return `${number.slice(0, 4)}.${number.slice(4, 7)}.${number.slice(7, 10)}`;
}
