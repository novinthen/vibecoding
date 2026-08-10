import type { ArticleStatus } from './enums';

/**
 * Public Article visibility.
 *
 * Publishing is an explicit editorial gate: an Article is publicly visible ONLY
 * when its status is `PUBLISHED`. Every earlier lifecycle state
 * (`DISCOVERED`, `NORMALIZED`, `QUEUED`, `ENRICHED`, `CLUSTERED`) is
 * pre-publication and must never appear on a public surface, and the excluded
 * states (`HIDDEN`, `DUPLICATE`, `FAILED`) obviously stay hidden too.
 *
 * Stage 3 ingestion continues to create Articles in its existing initial state
 * (it does not auto-publish); Stage 4's editorial status control is the current
 * manual publishing gate. Later stages (6/7) may promote Articles/Stories into
 * `PUBLISHED`, but Stage 5 must not anticipate that by exposing pre-publication
 * records.
 *
 * The rule is expressed once, here, as both a TypeScript predicate and a SQL
 * fragment so the application and the database agree on a single definition.
 */
export const PUBLIC_ARTICLE_STATUSES = [
  'PUBLISHED',
] as const satisfies readonly ArticleStatus[];

const PUBLIC_SET = new Set<ArticleStatus>(PUBLIC_ARTICLE_STATUSES);

/** Whether an Article in the given status may be shown publicly. */
export function isPubliclyVisibleArticle(status: ArticleStatus): boolean {
  return PUBLIC_SET.has(status);
}

/**
 * A parameter-free SQL predicate restricting a query to publicly-visible
 * (PUBLISHED) Articles. `alias` is the table alias/qualifier for the `articles`
 * row (e.g. `'a'` → `a.status`). The allowed status is inlined from the
 * controlled vocabulary (never from user input), so this introduces no injection
 * surface and needs no bound parameter.
 */
export function publicArticleStatusSql(alias = 'a'): string {
  const list = PUBLIC_ARTICLE_STATUSES.map((s) => `'${s}'`).join(', ');
  return `${alias}.status IN (${list})`;
}
