import type { Db } from '@/db/client';
import { PublicContentRepository } from '@/domain';
import type {
  PublicArticleDetail,
  PublicArticleListItem,
  PublicEntity,
  PublicSource,
  PublicStory,
  PublicTopicWithCount,
} from '@/public/types';

import {
  canonicalDefaultLocale,
  mergeLocalizedStory,
  resolveTargetLocale,
} from './locale';

/**
 * Page-ready public content composition.
 *
 * Thin functions over `PublicContentRepository` that assemble what a route
 * needs (resolve a slug, gather a list, compute pagination) so the page
 * components stay declarative and this logic is unit/integration testable in
 * isolation. Nothing here calls AI or fabricates data — empty inputs yield empty
 * results, which the pages render as honest empty states.
 */

export const PAGE_SIZE = 20;

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
}

function paginate(total: number, page: number, pageSize: number): Pagination {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(page, 1), totalPages);
  return {
    page: clampedPage,
    pageSize,
    total,
    totalPages,
    hasPrev: clampedPage > 1,
    hasNext: clampedPage < totalPages,
  };
}

/** Parse a 1-based page number from an untrusted query param. Defaults to 1. */
export function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.trunc(n), 10_000);
}

/** RFC-4122-ish UUID shape check, so a bad path param 404s instead of erroring. */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export interface HomeData {
  latest: PublicArticleListItem[];
  primarySource: PublicArticleListItem[];
  topics: PublicTopicWithCount[];
}

export async function getHomeData(db: Db): Promise<HomeData> {
  const repo = new PublicContentRepository(db);
  const [latest, primarySource, topics] = await Promise.all([
    repo.listArticles({ limit: 16 }),
    repo.listArticles({ authorityTier: 'PRIMARY', limit: 6 }),
    repo.listTopLevelTopicsWithCounts(),
  ]);
  return { latest, primarySource, topics };
}

export interface ArticleListPage {
  items: PublicArticleListItem[];
  pagination: Pagination;
}

export async function getLatest(
  db: Db,
  page: number,
): Promise<ArticleListPage> {
  const repo = new PublicContentRepository(db);
  const total = await repo.countArticles();
  const pagination = paginate(total, page, PAGE_SIZE);
  const items = await repo.listArticles({
    limit: PAGE_SIZE,
    offset: (pagination.page - 1) * PAGE_SIZE,
  });
  return { items, pagination };
}

export async function getArticle(
  db: Db,
  id: string,
): Promise<PublicArticleDetail | null> {
  if (!isUuid(id)) return null;
  return new PublicContentRepository(db).findArticleById(id);
}

export function getTopicIndex(db: Db): Promise<PublicTopicWithCount[]> {
  return new PublicContentRepository(db).listTopLevelTopicsWithCounts();
}

export interface TopicPage {
  topic: PublicTopicWithCount;
  items: PublicArticleListItem[];
  pagination: Pagination;
}

/** Resolve a Topic page by slug, or null when the Topic does not exist / is disabled. */
export async function getTopicPage(
  db: Db,
  slug: string,
  page: number,
): Promise<TopicPage | null> {
  const repo = new PublicContentRepository(db);
  const topics = await repo.listTopLevelTopicsWithCounts();
  const topic = topics.find((t) => t.slug === slug);
  if (!topic) return null;
  const topicIds = await repo.topicSelfAndChildIds(topic.id);
  const total = await repo.countArticles({ topicIds });
  const pagination = paginate(total, page, PAGE_SIZE);
  const items = await repo.listArticles({
    topicIds,
    limit: PAGE_SIZE,
    offset: (pagination.page - 1) * PAGE_SIZE,
  });
  return { topic, items, pagination };
}

export function getToolIndex(db: Db): Promise<PublicEntity[]> {
  return new PublicContentRepository(db).listEntities();
}

export interface ToolPage {
  entity: PublicEntity;
  items: PublicArticleListItem[];
  pagination: Pagination;
}

export async function getToolPage(
  db: Db,
  slug: string,
  page: number,
): Promise<ToolPage | null> {
  const repo = new PublicContentRepository(db);
  const entity = await repo.findEntityBySlug(slug);
  if (!entity) return null;
  const items = await repo.listArticlesForEntity(entity.id, {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  // Entity↔Article links are populated by later enrichment stages; counts are
  // small or zero today, so a lightweight single-page view is honest here.
  const pagination = paginate(
    items.length + (page - 1) * PAGE_SIZE,
    page,
    PAGE_SIZE,
  );
  return { entity, items, pagination };
}

export interface StoryPage {
  story: PublicStory;
  articles: PublicArticleListItem[];
  /** The locale actually rendered — for `<html lang>` / OG locale. */
  resolvedLocale: string;
  /** Whether an approved StoryLocalization supplied the content. */
  localized: boolean;
  /** Locales with an approved localisation (for SEO alternates / switching). */
  availableLocales: string[];
}

/**
 * Resolve a published Story for the active Publication, locale-aware.
 *
 * Returns null when the Publication is the in-code default (no id) or has no
 * PUBLISHED PublicationStory for the slug. Otherwise applies the documented
 * locale policy:
 *
 *   1. choose the target locale (valid `?locale=` param, else `defaultLocale`);
 *   2. use an approved (PUBLISHED) StoryLocalization for that locale;
 *   3. else, if the target differs, the default-locale localisation;
 *   4. else fall back to the Publication's canonical publication copy.
 *
 * Every localisation read is scoped to THIS PublicationStory, so content can
 * never leak from another Publication.
 */
export async function getStoryPage(
  db: Db,
  publicationId: string | null,
  defaultLocale: string,
  slug: string,
  requestedLocale?: string | string[] | null,
): Promise<StoryPage | null> {
  if (!publicationId) return null;
  const repo = new PublicContentRepository(db);
  const base = await repo.findPublishedStory(publicationId, slug);
  if (!base) return null;

  const canonicalDefault = canonicalDefaultLocale(defaultLocale);
  const target = resolveTargetLocale(defaultLocale, requestedLocale);

  let localization = await repo.findPublishedLocalization(
    base.publicationStoryId,
    target,
  );
  let resolvedLocale = target;
  if (!localization && target !== canonicalDefault) {
    localization = await repo.findPublishedLocalization(
      base.publicationStoryId,
      canonicalDefault,
    );
    resolvedLocale = canonicalDefault;
  }
  // Falling back to the Publication's canonical publication copy: rendered in
  // the Publication's default locale.
  if (!localization) resolvedLocale = canonicalDefault;

  const [articles, availableLocales] = await Promise.all([
    repo.listArticlesForStory(base.id),
    repo.listPublishedLocales(base.publicationStoryId),
  ]);

  return {
    story: mergeLocalizedStory(base, localization),
    articles,
    resolvedLocale,
    localized: localization !== null,
    availableLocales,
  };
}

export interface SearchResult {
  query: string;
  items: PublicArticleListItem[];
  pagination: Pagination;
}

export async function search(
  db: Db,
  rawQuery: string,
  page: number,
): Promise<SearchResult> {
  const query = rawQuery.trim();
  if (!query) {
    return {
      query: '',
      items: [],
      pagination: paginate(0, 1, PAGE_SIZE),
    };
  }
  const repo = new PublicContentRepository(db);
  const total = await repo.countSearch(query);
  const pagination = paginate(total, page, PAGE_SIZE);
  const items = await repo.searchArticles(query, {
    limit: PAGE_SIZE,
    offset: (pagination.page - 1) * PAGE_SIZE,
  });
  return { query, items, pagination };
}

export function getSources(db: Db): Promise<PublicSource[]> {
  return new PublicContentRepository(db).listPublicSources();
}
