import type { Db } from '@/db/client';

import { ArticleEnrichmentRepository } from '@/domain/repositories/article-enrichment-repository';
import { ArticleRepository } from '@/domain/repositories/article-repository';
import { PublicationStoryRepository } from '@/domain/repositories/publication-story-repository';
import { SourceRepository } from '@/domain/repositories/source-repository';
import { StoryRankingRepository } from '@/domain/repositories/story-ranking-repository';
import { StoryRepository } from '@/domain/repositories/story-repository';

import type { ArticleEnrichmentRow } from '@/domain/types';
import type { RankingInput, StoryRankingRow } from '@/domain/ranking-types';

import {
  calculateStoryRanking,
  RANKING_CONFIG_V1,
} from './ranking-service';

/**
 * Stage 8 — Ranking orchestration engine.
 *
 * Gathers data from multiple repositories, calls the pure ranking service,
 * and persists results. This layer handles I/O while keeping the ranking
 * formulas pure and testable.
 */
export class RankingEngine {
  private readonly storyRepo: StoryRepository;
  private readonly articleRepo: ArticleRepository;
  private readonly sourceRepo: SourceRepository;
  private readonly enrichmentRepo: ArticleEnrichmentRepository;
  private readonly publicationStoryRepo: PublicationStoryRepository;
  private readonly rankingRepo: StoryRankingRepository;

  constructor(private readonly db: Db) {
    this.storyRepo = new StoryRepository(db);
    this.articleRepo = new ArticleRepository(db);
    this.sourceRepo = new SourceRepository(db);
    this.enrichmentRepo = new ArticleEnrichmentRepository(db);
    this.publicationStoryRepo = new PublicationStoryRepository(db);
    this.rankingRepo = new StoryRankingRepository(db);
  }

  /**
   * Rank one Story and persist the result. Returns the created ranking row.
   * Optionally publication-specific (includes editorial context).
   * Force=true recalculates even if a recent ranking exists.
   */
  async rankStory(
    storyId: string,
    publicationId?: string | null,
    force = false,
  ): Promise<StoryRankingRow> {
    // Check if a recent ranking exists (within last hour, same version)
    if (!force) {
      const existing = await this.rankingRepo.findLatestForStory(
        storyId,
        publicationId ?? null,
      );
      if (existing && existing.ranking_version === RANKING_CONFIG_V1.version) {
        const ageMinutes =
          (Date.now() - new Date(existing.calculated_at).getTime()) / (1000 * 60);
        if (ageMinutes < 60) {
          // Recent ranking exists; return it without recalculating
          return existing;
        }
      }
    }

    // Gather data for ranking
    const input = await this.gatherRankingInput(storyId, publicationId ?? null);
    if (!input) {
      throw new Error(`Story ${storyId} not found or has no data`);
    }

    // Calculate ranking
    const result = calculateStoryRanking(input, RANKING_CONFIG_V1);

    // Persist
    const ranking = await this.rankingRepo.create({
      storyId,
      publicationId: publicationId ?? null,
      rankingMethod: result.method,
      rankingVersion: result.version,
      calculatedScore: result.score,
      signals: result.signals,
      calculatedAt: new Date(),
      timeHorizon: result.timeHorizon,
      explanation: result.explanation,
    });

    return ranking;
  }

  /**
   * Rank multiple Stories in one pass. More efficient than calling rankStory
   * repeatedly. Returns rankings in the same order as input Story IDs.
   */
  async rankStories(
    storyIds: string[],
    publicationId?: string | null,
  ): Promise<StoryRankingRow[]> {
    if (storyIds.length === 0) return [];

    const rankings: StoryRankingRow[] = [];

    for (const storyId of storyIds) {
      try {
        const ranking = await this.rankStory(storyId, publicationId, false);
        rankings.push(ranking);
      } catch (err) {
        // Log error but continue ranking other Stories
        console.error(`Failed to rank Story ${storyId}:`, err);
      }
    }

    return rankings;
  }

  /**
   * Gather all data needed for ranking one Story. Returns null if Story
   * not found or has no Articles.
   */
  private async gatherRankingInput(
    storyId: string,
    publicationId: string | null,
  ): Promise<RankingInput | null> {
    // Fetch Story
    const story = await this.storyRepo.findById(storyId);
    if (!story) return null;

    // Fetch Articles belonging to Story
    const articleIds = await this.storyRepo.listArticleIds(storyId);
    if (articleIds.length === 0) return null;

    const articles = await Promise.all(
      articleIds.map((id) => this.articleRepo.findById(id)),
    );
    const validArticles = articles.filter((a) => a !== null);
    if (validArticles.length === 0) return null;

    // Fetch Sources for those Articles
    const sourceIds = Array.from(
      new Set(validArticles.map((a) => a!.source_id)),
    );
    const sources = await Promise.all(
      sourceIds.map((id) => this.sourceRepo.findById(id)),
    );
    const validSources = sources.filter((s) => s !== null);

    // Fetch enrichments (may be empty if AI enrichment is unavailable)
    const enrichments = await Promise.all(
      articleIds.map((id) => this.enrichmentRepo.findLatest(id)),
    );
    const validEnrichments = enrichments
      .filter((e): e is ArticleEnrichmentRow => e !== null)
      .map((e) => ({
        articleId: e.article_id,
        importanceScore: e.importance_score,
        status: e.status,
      }));

    // Fetch publication context if publication-specific ranking
    let publicationContext = null;
    if (publicationId) {
      const pubStory = await this.publicationStoryRepo.findByPublicationAndStory(
        publicationId,
        storyId,
      );
      if (pubStory) {
        publicationContext = {
          featured: pubStory.featured,
          editorialPriority: pubStory.editorial_priority,
          suppressRanking: pubStory.suppress_ranking ?? false,
        };
      }
    }

    return {
      story: {
        id: story.id,
        lastActivityAt: story.last_activity_at
          ? new Date(story.last_activity_at)
          : null,
        createdAt: new Date(story.created_at),
      },
      articles: validArticles.map((a) => ({
        id: a!.id,
        sourceId: a!.source_id,
        publishedAt: a!.published_at ? new Date(a!.published_at) : null,
        discoveredAt: new Date(a!.discovered_at),
      })),
      sources: validSources.map((s) => ({
        id: s!.id,
        authorityTier: s!.authority_tier,
      })),
      enrichments: validEnrichments,
      publicationContext,
      referenceTime: new Date(),
    };
  }
}
