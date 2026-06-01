/**
 * Tidy up the residue KBO leaves on director / corporate-mandate
 * holder-name cells:
 *   - orphan parens from stripped "(Since YYYY-MM-DD)" markers,
 *   - stray space-before-comma ("Hilami , Ahmed"),
 *   - dangling trailing punctuation,
 *   - the comma itself ("Hilami, Ahmed" → "Hilami Ahmed") — KBO renders
 *     LASTNAME, FIRSTNAME, which reads strangely in English output.
 *
 * Pure display-layer fix so existing cached rows clean up on render —
 * no re-scrape required.
 */
export function cleanHolderName(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw.replace(/\s*\([^)]*\)\s*$/g, ""); // strip trailing "(…)" groups
  s = s.replace(/\s*\(\s*\)\s*/g, " "); // any remaining empty "()"
  s = s.replace(/\s*\(\s*$/, ""); // orphan open paren at end
  s = s.replace(/\s*,\s*/g, " "); // drop commas, keep words separated
  s = s.replace(/\s+/g, " ").trim(); // collapse internal whitespace
  s = s.replace(/[;:.\-–—\s]+$/, "").trim(); // drop trailing junk
  return s;
}
