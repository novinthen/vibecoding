import type { ArticleStatus } from './enums';

/**
 * Public Article visibility.
 *
 * The portal is a discovery/aggregation layer over canonically-ingested
 * Articles. AI relevance classification and Story clustering are later stages
 * (6/7), so there is no "PUBLISHED" gate to rely on yet — ingested Articles land
 * in `DISCOVERED`. Rather than fake a curated feed, the public surface shows
 * genuinely ingested Articles while excluding the three states that must never
 * be shown:
 *
 *   - HIDDEN    — an editor deliberately removed it from public view;
 *   - DUPLICATE — exact-dedup marked it a copy of another Article;
 *   - FAILED    — ingestion did not produce a usable record.
 *
 * This is expressed once, here, as both a TypeScript predicate and a SQL
 * fragment so the application and the database agree on a single rule. When
 * Stage 6/7 introduce real relevance/clustering, this is the seam to tighten.
 */
export const NON_PUBLIC_ARTICLE_STATUSES = [
  'HIDDEN',
  'DUPLICATE',
  'FAILED',
] as const satisfies readonly ArticleStatus[];

const NON_PUBLIC_SET = new Set<ArticleStatus>(NON_PUBLIC_ARTICLE_STATUSES);

/** Whether an Article in the given status may be shown publicly. */
export function isPubliclyVisibleArticle(status: ArticleStatus): boolean {
  return !NON_PUBLIC_SET.has(status);
}

/**
 * A parameter-free SQL predicate restricting a query to publicly-visible
 * Articles. `alias` is the table alias/qualifier for the `articles` row (e.g.
 * `'a'` → `a.status`). The excluded statuses are inlined from the controlled
 * vocabulary (never from user input), so this introduces no injection surface
 * and needs no bound parameter.
 */
export function publicArticleStatusSql(alias = 'a'): string {
  const list = NON_PUBLIC_ARTICLE_STATUSES.map((s) => `'${s}'`).join(', ');
  return `${alias}.status NOT IN (${list})`;
}
