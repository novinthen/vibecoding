/**
 * BCP-47-ish locale validation and canonicalisation.
 *
 * Locales are stored as rows (a Publication default_locale, a StoryLocalization
 * locale), never as language columns. The platform is multi-locale by design, so
 * nothing here hardcodes a single language or region. This is a deliberately
 * conservative subset of BCP-47 — enough for real Publications
 * (`en`, `ms`, `en-US`, `zh-Hans`, `pt-BR`) without accepting arbitrary text:
 *
 *   language (2–3 letters), optional script (4 letters), optional region
 *   (2 letters or 3 digits).
 *
 * Matching is case-insensitive; the canonical form lowercases the language,
 * Title-cases the script, and uppercases an alphabetic region, so lookups and
 * comparisons are deterministic regardless of how a locale was entered.
 */
const LOCALE_RE = /^([a-z]{2,3})(?:-([a-z]{4}))?(?:-([a-z]{2}|[0-9]{3}))?$/i;

/** Canonicalise a locale string, or return null when it is not well-formed. */
export function canonicalizeLocale(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = LOCALE_RE.exec(trimmed);
  if (!match) return null;
  const [, language, script, region] = match;
  let out = language!.toLowerCase();
  if (script) {
    out += `-${script.charAt(0).toUpperCase()}${script.slice(1).toLowerCase()}`;
  }
  if (region) {
    // Numeric UN M.49 regions stay as-is; alphabetic regions uppercase.
    out += `-${/^[0-9]{3}$/.test(region) ? region : region.toUpperCase()}`;
  }
  return out;
}

/** Whether a string is a well-formed locale under the supported subset. */
export function isValidLocale(input: string): boolean {
  return canonicalizeLocale(input) !== null;
}
