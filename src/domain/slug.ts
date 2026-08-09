/**
 * Deterministic, locale-independent slug generation.
 *
 * Pure and side-effect free so it can be reused by seeds, repositories, and
 * future ingestion without pulling in a dependency. Intentionally conservative:
 * lowercases, strips diacritics, and collapses any non-alphanumeric run to a
 * single hyphen. It does NOT assume any single language or brand.
 */
export function slugify(input: string): string {
  return (
    input
      .normalize('NFKD')
      // Remove combining diacritical marks left by NFKD decomposition.
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  );
}
