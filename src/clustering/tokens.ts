/**
 * Shared, language-agnostic tokenisation for clustering signals (Stage 7).
 *
 * Used by both the fake embedding provider (bag-of-tokens hashing) and the
 * title-overlap signal, so the two agree on what a "token" is. Pure and
 * side-effect free: lowercase, strip diacritics, split on any non-alphanumeric
 * run, and drop single-character tokens as noise.
 */
export function tokenize(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);
}

/** Distinct tokens of a text as a Set (for overlap/Jaccard signals). */
export function tokenSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

/** Jaccard overlap |A∩B| / |A∪B| of two token sets; 0 when both are empty. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
