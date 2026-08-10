import type { MetadataRoute } from 'next';

import { PublicContentRepository } from '@/domain';
import { getDb, isDatabaseConfigured } from '@/public/db';
import { getActivePublication } from '@/public/request';

/**
 * Publication-aware sitemap. URLs are built from the request host (never a
 * hardcoded domain). Static navigation entries are always present; Topic, Tool,
 * and recent Article URLs are added from live canonical data when a database is
 * configured. `/search` (noindex) and `/admin` are intentionally excluded.
 */
export const dynamic = 'force-dynamic';

const STATIC_PATHS = ['/', '/latest', '/topic', '/tool', '/sources', '/about'];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { baseUrl } = await getActivePublication();
  const abs = (path: string): string => `${baseUrl}${path}`;

  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: abs(path),
    changeFrequency: 'daily',
  }));

  if (!isDatabaseConfigured()) return staticEntries;

  try {
    const repo = new PublicContentRepository(getDb());
    const [topics, entities, articles] = await Promise.all([
      repo.listTopLevelTopicsWithCounts(),
      repo.listEntities(),
      repo.listArticles({ limit: 200 }),
    ]);
    return [
      ...staticEntries,
      ...topics.map((topic) => ({ url: abs(`/topic/${topic.slug}`) })),
      ...entities.map((entity) => ({ url: abs(`/tool/${entity.slug}`) })),
      ...articles.map((article) => ({
        url: abs(`/article/${article.id}`),
        lastModified: article.publishedAt ?? article.discoveredAt,
      })),
    ];
  } catch {
    // A data-layer failure must not break the sitemap; serve the static core.
    return staticEntries;
  }
}
