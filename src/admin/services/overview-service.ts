import type { Db } from '@/db/client';
import {
  ArticleRepository,
  SourceFetchRepository,
  SourceRepository,
} from '@/domain';
import type { HealthStatus } from '@/domain/enums';
import type { SourceFetchWithSourceRow } from '@/domain/repositories/source-fetch-repository';
import type { ArticleRow, SourceRow } from '@/domain/types';

/**
 * Operational overview aggregation (Stage 4).
 *
 * Answers the Overview screen's questions in a single read: how many Sources are
 * healthy/degraded/failing, what failed recently, what was ingested recently,
 * and which Sources need attention. Pure reads — no mutation, no audit.
 */
export interface AdminOverview {
  sourceHealth: Record<HealthStatus, number>;
  totalSources: number;
  totalArticles: number;
  recentFetches: SourceFetchWithSourceRow[];
  recentFailures: SourceFetchWithSourceRow[];
  recentArticles: ArticleRow[];
  attentionSources: SourceRow[];
}

export async function getOverview(db: Db): Promise<AdminOverview> {
  const sources = new SourceRepository(db);
  const fetches = new SourceFetchRepository(db);
  const articles = new ArticleRepository(db);

  const [
    sourceHealth,
    allSources,
    recentFetches,
    recentFailures,
    recentArticles,
    totalArticles,
  ] = await Promise.all([
    sources.countByHealth(),
    sources.listAll(),
    fetches.listRecentGlobal({ limit: 10 }),
    fetches.listRecentGlobal({ limit: 10, status: 'FAILED' }),
    articles.listRecentlyDiscovered(10),
    articles.count(),
  ]);

  const totalSources = allSources.length;
  // Sources needing attention: enabled but not healthy (degraded/failing/unknown).
  const attentionSources = allSources.filter(
    (source) =>
      source.enabled &&
      (source.health_status === 'FAILING' ||
        source.health_status === 'DEGRADED'),
  );

  return {
    sourceHealth,
    totalSources,
    totalArticles,
    recentFetches,
    recentFailures,
    recentArticles,
    attentionSources,
  };
}
