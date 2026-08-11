import { describe, expect, it } from 'vitest';

import type { RankingConfig, RankingInput } from '@/domain/ranking-types';

import {
  calculateAiImportanceScore,
  calculateEditorialAdjustment,
  calculateFreshnessScore,
  calculateNoveltyScore,
  calculateSourceAuthorityScore,
  calculateSourceDiversityScore,
  calculateStoryActivityScore,
  calculateStoryRanking,
  RANKING_CONFIG_V1,
} from '@/ranking/ranking-service';

describe('Ranking Service — Pure Formulas', () => {
  describe('calculateFreshnessScore', () => {
    const config: RankingConfig = {
      ...RANKING_CONFIG_V1,
      freshnessHalfLifeHours: 24,
    };
    const now = new Date('2024-01-10T12:00:00Z');

    it('returns 1.0 for current timestamp', () => {
      const score = calculateFreshnessScore(now, now, config);
      expect(score).toBe(1.0);
    });

    it('returns ~0.5 at half-life (24h)', () => {
      const yesterday = new Date('2024-01-09T12:00:00Z');
      const score = calculateFreshnessScore(yesterday, now, config);
      expect(score).toBeCloseTo(0.5, 2);
    });

    it('returns ~0.25 at 2x half-life (48h)', () => {
      const twoDaysAgo = new Date('2024-01-08T12:00:00Z');
      const score = calculateFreshnessScore(twoDaysAgo, now, config);
      expect(score).toBeCloseTo(0.25, 2);
    });

    it('returns 0.0 for null lastActivityAt', () => {
      const score = calculateFreshnessScore(null, now, config);
      expect(score).toBe(0.0);
    });

    it('returns 1.0 for future timestamp (clock skew)', () => {
      const future = new Date('2024-01-11T12:00:00Z');
      const score = calculateFreshnessScore(future, now, config);
      expect(score).toBe(1.0);
    });
  });

  describe('calculateSourceDiversityScore', () => {
    const config: RankingConfig = {
      ...RANKING_CONFIG_V1,
      maxExpectedSources: 10,
    };

    it('returns 0.0 for zero sources', () => {
      expect(calculateSourceDiversityScore(0, config)).toBe(0.0);
    });

    it('returns 0.1 for 1 source (1/10)', () => {
      expect(calculateSourceDiversityScore(1, config)).toBe(0.1);
    });

    it('returns 0.5 for 5 sources', () => {
      expect(calculateSourceDiversityScore(5, config)).toBe(0.5);
    });

    it('returns 1.0 for 10 sources (max expected)', () => {
      expect(calculateSourceDiversityScore(10, config)).toBe(1.0);
    });

    it('caps at 1.0 for > max expected sources', () => {
      expect(calculateSourceDiversityScore(15, config)).toBe(1.0);
    });
  });

  describe('calculateSourceAuthorityScore', () => {
    const config = RANKING_CONFIG_V1;

    it('returns 0.0 for no sources', () => {
      expect(calculateSourceAuthorityScore([], config)).toBe(0.0);
    });

    it('returns 1.0 for PRIMARY source', () => {
      const sources = [{ authorityTier: 'PRIMARY' }];
      expect(calculateSourceAuthorityScore(sources, config)).toBe(1.0);
    });

    it('returns 0.8 for TRUSTED source', () => {
      const sources = [{ authorityTier: 'TRUSTED' }];
      expect(calculateSourceAuthorityScore(sources, config)).toBe(0.8);
    });

    it('returns 0.6 for SPECIALIST source', () => {
      const sources = [{ authorityTier: 'SPECIALIST' }];
      expect(calculateSourceAuthorityScore(sources, config)).toBe(0.6);
    });

    it('returns 0.4 for COMMUNITY source', () => {
      const sources = [{ authorityTier: 'COMMUNITY' }];
      expect(calculateSourceAuthorityScore(sources, config)).toBe(0.4);
    });

    it('returns 0.2 for DISCOVERY source', () => {
      const sources = [{ authorityTier: 'DISCOVERY' }];
      expect(calculateSourceAuthorityScore(sources, config)).toBe(0.2);
    });

    it('averages multiple sources correctly', () => {
      const sources = [
        { authorityTier: 'PRIMARY' }, // 1.0
        { authorityTier: 'COMMUNITY' }, // 0.4
      ];
      const score = calculateSourceAuthorityScore(sources, config);
      expect(score).toBeCloseTo(0.7, 2); // (1.0 + 0.4) / 2
    });
  });

  describe('calculateStoryActivityScore', () => {
    const config: RankingConfig = {
      ...RANKING_CONFIG_V1,
      activityWindowHours: 168,
    }; // 7 days
    const now = new Date('2024-01-10T12:00:00Z');

    it('returns 0.0 for no articles', () => {
      expect(calculateStoryActivityScore([], now, config)).toBe(0.0);
    });

    it('returns 0.0 for articles outside window', () => {
      const oldArticles = [
        {
          publishedAt: new Date('2024-01-01T12:00:00Z'),
          discoveredAt: new Date('2024-01-01T12:00:00Z'),
        },
      ];
      expect(calculateStoryActivityScore(oldArticles, now, config)).toBe(0.0);
    });

    it('counts articles within window', () => {
      const recentArticles = [
        {
          publishedAt: new Date('2024-01-09T12:00:00Z'), // 1 day ago
          discoveredAt: new Date('2024-01-09T12:00:00Z'),
        },
        {
          publishedAt: new Date('2024-01-08T12:00:00Z'), // 2 days ago
          discoveredAt: new Date('2024-01-08T12:00:00Z'),
        },
      ];
      const score = calculateStoryActivityScore(recentArticles, now, config);
      expect(score).toBeCloseTo(0.2, 2); // 2 / 10
    });

    it('falls back to discoveredAt when publishedAt is null', () => {
      const articles = [
        {
          publishedAt: null,
          discoveredAt: new Date('2024-01-09T12:00:00Z'),
        },
      ];
      const score = calculateStoryActivityScore(articles, now, config);
      expect(score).toBeCloseTo(0.1, 2); // 1 / 10
    });

    it('caps at 1.0 for high activity', () => {
      const manyArticles = Array.from({ length: 20 }, (_, i) => ({
        publishedAt: new Date(now.getTime() - i * 60 * 60 * 1000), // every hour
        discoveredAt: new Date(now.getTime() - i * 60 * 60 * 1000),
      }));
      const score = calculateStoryActivityScore(manyArticles, now, config);
      expect(score).toBe(1.0);
    });
  });

  describe('calculateNoveltyScore', () => {
    const config: RankingConfig = {
      ...RANKING_CONFIG_V1,
      noveltyHalfLifeHours: 72,
    }; // 3 days
    const now = new Date('2024-01-10T12:00:00Z');

    it('returns 1.0 for just-created story', () => {
      const score = calculateNoveltyScore(now, now, config);
      expect(score).toBe(1.0);
    });

    it('returns ~0.5 at half-life (72h)', () => {
      const threeDaysAgo = new Date('2024-01-07T12:00:00Z');
      const score = calculateNoveltyScore(threeDaysAgo, now, config);
      expect(score).toBeCloseTo(0.5, 2);
    });

    it('decays over time', () => {
      const sixDaysAgo = new Date('2024-01-04T12:00:00Z');
      const score = calculateNoveltyScore(sixDaysAgo, now, config);
      expect(score).toBeCloseTo(0.25, 2); // 2x half-life
    });

    it('returns 1.0 for future timestamp', () => {
      const future = new Date('2024-01-11T12:00:00Z');
      const score = calculateNoveltyScore(future, now, config);
      expect(score).toBe(1.0);
    });
  });

  describe('calculateAiImportanceScore', () => {
    const config = RANKING_CONFIG_V1;

    it('returns null for no enrichments', () => {
      expect(calculateAiImportanceScore([], config)).toBeNull();
    });

    it('returns null for all failed enrichments', () => {
      const enrichments = [
        { articleId: '1', importanceScore: null, status: 'PROVIDER_ERROR' },
        { articleId: '2', importanceScore: null, status: 'INVALID_OUTPUT' },
      ];
      expect(calculateAiImportanceScore(enrichments, config)).toBeNull();
    });

    it('returns max score across successful enrichments', () => {
      const enrichments = [
        { articleId: '1', importanceScore: 0.7, status: 'SUCCEEDED' },
        { articleId: '2', importanceScore: 0.9, status: 'SUCCEEDED' },
        { articleId: '3', importanceScore: 0.5, status: 'SUCCEEDED' },
      ];
      expect(calculateAiImportanceScore(enrichments, config)).toBe(0.9);
    });

    it('ignores failed enrichments when calculating', () => {
      const enrichments = [
        { articleId: '1', importanceScore: 0.8, status: 'SUCCEEDED' },
        { articleId: '2', importanceScore: null, status: 'PROVIDER_ERROR' },
      ];
      expect(calculateAiImportanceScore(enrichments, config)).toBe(0.8);
    });
  });

  describe('calculateEditorialAdjustment', () => {
    const config: RankingConfig = {
      ...RANKING_CONFIG_V1,
      editorialPriorityScale: 0.1,
      featuredBoost: 0.5,
    };

    it('returns 0.0 for null context', () => {
      expect(calculateEditorialAdjustment(null, config)).toBe(0.0);
    });

    it('returns 0.0 for default context', () => {
      const context = {
        featured: false,
        editorialPriority: 0,
        suppressRanking: false,
      };
      expect(calculateEditorialAdjustment(context, config)).toBe(0.0);
    });

    it('applies featured boost', () => {
      const context = {
        featured: true,
        editorialPriority: 0,
        suppressRanking: false,
      };
      expect(calculateEditorialAdjustment(context, config)).toBe(0.5);
    });

    it('scales editorial priority', () => {
      const context = {
        featured: false,
        editorialPriority: 10,
        suppressRanking: false,
      };
      expect(calculateEditorialAdjustment(context, config)).toBe(1.0); // 10 * 0.1
    });

    it('combines featured + priority', () => {
      const context = {
        featured: true,
        editorialPriority: 5,
        suppressRanking: false,
      };
      const adjustment = calculateEditorialAdjustment(context, config);
      expect(adjustment).toBeCloseTo(1.0, 2); // 0.5 (featured) + 0.5 (5 * 0.1)
    });

    it('returns large negative for suppressed ranking', () => {
      const context = {
        featured: true,
        editorialPriority: 10,
        suppressRanking: true,
      };
      expect(calculateEditorialAdjustment(context, config)).toBe(-1000);
    });
  });

  describe('calculateStoryRanking — integration', () => {
    const now = new Date('2024-01-10T12:00:00Z');

    it('calculates complete ranking for a typical story', () => {
      const input: RankingInput = {
        story: {
          id: 'story-1',
          lastActivityAt: new Date('2024-01-09T12:00:00Z'), // 1 day ago
          createdAt: new Date('2024-01-08T12:00:00Z'), // 2 days ago
        },
        articles: [
          {
            id: 'a1',
            sourceId: 's1',
            publishedAt: new Date('2024-01-09T12:00:00Z'),
            discoveredAt: new Date('2024-01-09T12:00:00Z'),
          },
          {
            id: 'a2',
            sourceId: 's2',
            publishedAt: new Date('2024-01-09T06:00:00Z'),
            discoveredAt: new Date('2024-01-09T06:00:00Z'),
          },
        ],
        sources: [
          { id: 's1', authorityTier: 'PRIMARY' },
          { id: 's2', authorityTier: 'TRUSTED' },
        ],
        enrichments: [
          { articleId: 'a1', importanceScore: 0.8, status: 'SUCCEEDED' },
          { articleId: 'a2', importanceScore: 0.7, status: 'SUCCEEDED' },
        ],
        publicationContext: null,
        referenceTime: now,
      };

      const result = calculateStoryRanking(input);

      expect(result.score).toBeGreaterThan(0);
      expect(result.signals.freshness).toBeCloseTo(0.5, 1);
      expect(result.signals.sourceDiversity).toBe(0.2); // 2/10
      expect(result.signals.sourceAuthority).toBe(0.9); // (1.0 + 0.8) / 2
      expect(result.signals.storyActivity).toBe(0.2); // 2/10
      expect(result.signals.novelty).toBeGreaterThan(0);
      expect(result.signals.aiImportance).toBe(0.8); // max
      expect(result.signals.editorialAdjustment).toBe(0);
      expect(result.method).toBe('weighted-sum');
      expect(result.version).toBe('ranking-score-v1');
      expect(result.explanation).toContain('Base score');
    });

    it('applies editorial boost correctly', () => {
      const input: RankingInput = {
        story: {
          id: 'story-1',
          lastActivityAt: now,
          createdAt: now,
        },
        articles: [
          {
            id: 'a1',
            sourceId: 's1',
            publishedAt: now,
            discoveredAt: now,
          },
        ],
        sources: [{ id: 's1', authorityTier: 'PRIMARY' }],
        enrichments: [],
        publicationContext: {
          featured: true,
          editorialPriority: 5,
          suppressRanking: false,
        },
        referenceTime: now,
      };

      const result = calculateStoryRanking(input);

      // Featured is NOT a numeric boost (featuredBoost = 0)
      // Only editorial priority is applied: 5 * 0.1 = 0.5
      expect(result.signals.editorialAdjustment).toBeCloseTo(0.5, 2);
      expect(result.score).toBeGreaterThan(0.5); // base score + adjustment
    });

    it('handles missing AI enrichment gracefully', () => {
      const input: RankingInput = {
        story: {
          id: 'story-1',
          lastActivityAt: now,
          createdAt: now,
        },
        articles: [
          {
            id: 'a1',
            sourceId: 's1',
            publishedAt: now,
            discoveredAt: now,
          },
        ],
        sources: [{ id: 's1', authorityTier: 'PRIMARY' }],
        enrichments: [], // No enrichments
        publicationContext: null,
        referenceTime: now,
      };

      const result = calculateStoryRanking(input);

      expect(result.signals.aiImportance).toBeNull();
      expect(result.score).toBeGreaterThan(0); // Still calculates other signals
      expect(result.explanation).toContain('unavailable');
    });

    it('deterministic: same inputs produce same score', () => {
      const input: RankingInput = {
        story: {
          id: 'story-1',
          lastActivityAt: new Date('2024-01-09T12:00:00Z'),
          createdAt: new Date('2024-01-08T12:00:00Z'),
        },
        articles: [
          {
            id: 'a1',
            sourceId: 's1',
            publishedAt: new Date('2024-01-09T12:00:00Z'),
            discoveredAt: new Date('2024-01-09T12:00:00Z'),
          },
        ],
        sources: [{ id: 's1', authorityTier: 'TRUSTED' }],
        enrichments: [
          { articleId: 'a1', importanceScore: 0.75, status: 'SUCCEEDED' },
        ],
        publicationContext: null,
        referenceTime: now,
      };

      const result1 = calculateStoryRanking(input);
      const result2 = calculateStoryRanking(input);

      expect(result1.score).toBe(result2.score);
      expect(result1.signals).toEqual(result2.signals);
    });
  });
});
