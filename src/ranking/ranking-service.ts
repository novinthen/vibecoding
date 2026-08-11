import type {
  RankingConfig,
  RankingInput,
  RankingResult,
  RankingSignals,
} from '@/domain/ranking-types';

/**
 * Stage 8 — Pure, deterministic ranking formulas.
 *
 * This service calculates Story ranking scores from transparent, versioned
 * signals. All functions are pure (no I/O, no side effects) for testability.
 * Ranking NEVER alters Story membership, Article source facts, or publishes.
 */

/**
 * Default ranking configuration v1. Weights and parameters are explicit so
 * formula changes are auditable across versions.
 *
 * Note: Featured is NOT numerically boosted here. It remains a separate
 * editorial tier applied in public ordering (ORDER BY featured DESC).
 */
export const RANKING_CONFIG_V1: RankingConfig = {
  version: 'ranking-score-v1',
  weights: {
    freshness: 0.3,
    sourceDiversity: 0.15,
    sourceAuthority: 0.15,
    storyActivity: 0.15,
    novelty: 0.1,
    aiImportance: 0.15,
  },
  freshnessHalfLifeHours: 24,
  maxExpectedSources: 10,
  activityWindowHours: 168, // 7 days
  noveltyHalfLifeHours: 72, // 3 days
  editorialPriorityScale: 0.1,
  featuredBoost: 0, // Featured is a separate ordering tier, not a numeric boost
};

/**
 * Calculate the complete ranking for a Story using the given config.
 * Returns score, component signals, and explanation.
 */
export function calculateStoryRanking(
  input: RankingInput,
  config: RankingConfig = RANKING_CONFIG_V1,
): RankingResult {
  const now = input.referenceTime ?? new Date();

  // Calculate component signals (each normalized to [0, 1])
  const freshness = calculateFreshnessScore(
    input.story.lastActivityAt,
    now,
    config,
  );

  const sourceDiversity = calculateSourceDiversityScore(
    countDistinctSources(input.articles),
    config,
  );

  const sourceAuthority = calculateSourceAuthorityScore(input.sources, config);

  const storyActivity = calculateStoryActivityScore(
    input.articles,
    now,
    config,
  );

  const novelty = calculateNoveltyScore(input.story.createdAt, now, config);

  const aiImportance = calculateAiImportanceScore(input.enrichments, config);

  const editorialAdjustment = calculateEditorialAdjustment(
    input.publicationContext,
    config,
  );

  // Combine signals using weighted sum
  const baseScore =
    freshness * config.weights.freshness +
    sourceDiversity * config.weights.sourceDiversity +
    sourceAuthority * config.weights.sourceAuthority +
    storyActivity * config.weights.storyActivity +
    novelty * config.weights.novelty +
    (aiImportance ?? 0) * config.weights.aiImportance;

  const finalScore = baseScore + editorialAdjustment;

  const signals: RankingSignals = {
    freshness,
    sourceDiversity,
    sourceAuthority,
    storyActivity,
    novelty,
    aiImportance,
    editorialAdjustment,
    publicationContext: input.publicationContext ?? null,
  };

  const explanation = buildExplanation(signals, config, baseScore, finalScore);

  return {
    score: finalScore,
    signals,
    explanation,
    method: 'weighted-sum',
    version: config.version,
    timeHorizon: `activity-window-${config.activityWindowHours}h`,
  };
}

/**
 * Freshness score: exponential decay from last activity timestamp.
 * Score = 0.5^(hours_elapsed / half_life_hours)
 * Returns 1.0 for just-now, 0.5 at half-life, approaches 0 as time passes.
 */
export function calculateFreshnessScore(
  lastActivityAt: Date | null,
  now: Date,
  config: RankingConfig,
): number {
  if (!lastActivityAt) return 0.0;

  const hoursElapsed =
    (now.getTime() - lastActivityAt.getTime()) / (1000 * 60 * 60);
  if (hoursElapsed < 0) return 1.0; // Future timestamp (clock skew): treat as fresh

  const score = Math.pow(0.5, hoursElapsed / config.freshnessHalfLifeHours);
  return Math.min(Math.max(score, 0), 1);
}

/**
 * Source diversity score: rewards Stories covered by multiple independent Sources.
 * Normalized by expected max. Defends against same-source duplication.
 */
export function calculateSourceDiversityScore(
  distinctSourceCount: number,
  config: RankingConfig,
): number {
  if (distinctSourceCount <= 0) return 0.0;
  const normalized = distinctSourceCount / config.maxExpectedSources;
  return Math.min(normalized, 1.0);
}

/**
 * Source authority score: weighted average of authority tiers.
 * PRIMARY=1.0, TRUSTED=0.8, SPECIALIST=0.6, COMMUNITY=0.4, DISCOVERY=0.2
 */
export function calculateSourceAuthorityScore(
  sources: Array<{ authorityTier: string }>,
  _config: RankingConfig,
): number {
  if (sources.length === 0) return 0.0;

  const weights = sources.map((s) => authorityTierWeight(s.authorityTier));
  const average = weights.reduce((sum, w) => sum + w, 0) / weights.length;
  return Math.min(Math.max(average, 0), 1);
}

/**
 * Story activity score: count recent Articles within the activity window.
 * Normalized to [0, 1]. Rewards velocity (many recent Articles).
 */
export function calculateStoryActivityScore(
  articles: Array<{ publishedAt: Date | null; discoveredAt: Date }>,
  now: Date,
  config: RankingConfig,
): number {
  const windowStart = new Date(
    now.getTime() - config.activityWindowHours * 60 * 60 * 1000,
  );

  const recentCount = articles.filter((a) => {
    const refTime = a.publishedAt ?? a.discoveredAt;
    return refTime >= windowStart;
  }).length;

  // Normalize: 0 = no recent articles, 10+ = maximum activity
  const maxExpectedRecent = 10;
  const normalized = recentCount / maxExpectedRecent;
  return Math.min(normalized, 1.0);
}

/**
 * Novelty score: exponential decay from Story creation.
 * Recently formed Stories score higher. Similar to freshness but anchored
 * to Story formation, not last activity.
 */
export function calculateNoveltyScore(
  storyCreatedAt: Date,
  now: Date,
  config: RankingConfig,
): number {
  const hoursElapsed =
    (now.getTime() - storyCreatedAt.getTime()) / (1000 * 60 * 60);
  if (hoursElapsed < 0) return 1.0; // Future timestamp: treat as novel

  const score = Math.pow(0.5, hoursElapsed / config.noveltyHalfLifeHours);
  return Math.min(Math.max(score, 0), 1);
}

/**
 * AI importance score: aggregate Stage 6 enrichment importance scores across
 * the Story's Articles. Returns null if no enrichments are available (graceful
 * fallback). Takes the maximum importance score across successful enrichments.
 */
export function calculateAiImportanceScore(
  enrichments: Array<{
    articleId: string;
    importanceScore: number | null;
    status: string;
  }>,
  _config: RankingConfig,
): number | null {
  const successfulScores = enrichments
    .filter((e) => e.status === 'SUCCEEDED' && e.importanceScore !== null)
    .map((e) => e.importanceScore as number);

  if (successfulScores.length === 0) return null;

  // Use max importance across Articles (the Story is as important as its most important Article)
  const maxScore = Math.max(...successfulScores);
  return Math.min(Math.max(maxScore, 0), 1);
}

/**
 * Editorial adjustment: apply Publication-specific overrides.
 * editorial_priority is scaled by editorialPriorityScale.
 * featured adds a fixed boost.
 * suppress_ranking returns a large negative penalty (effectively excludes from ranked lists).
 */
export function calculateEditorialAdjustment(
  publicationContext:
    | {
        featured: boolean;
        editorialPriority: number;
        suppressRanking: boolean;
      }
    | null
    | undefined,
  config: RankingConfig,
): number {
  if (!publicationContext) return 0.0;

  if (publicationContext.suppressRanking) {
    return -1000; // Large negative penalty: effectively removes from ranked lists
  }

  let adjustment = 0.0;

  // Scale editorial priority
  adjustment +=
    publicationContext.editorialPriority * config.editorialPriorityScale;

  // Featured boost
  if (publicationContext.featured) {
    adjustment += config.featuredBoost;
  }

  return adjustment;
}

/**
 * Count distinct Sources across Articles (for source diversity).
 * Defends against duplicate same-Source Articles inflating diversity.
 */
function countDistinctSources(articles: Array<{ sourceId: string }>): number {
  const uniqueSources = new Set(articles.map((a) => a.sourceId));
  return uniqueSources.size;
}

/**
 * Map authority tier to numeric weight.
 */
function authorityTierWeight(tier: string): number {
  switch (tier.toUpperCase()) {
    case 'PRIMARY':
      return 1.0;
    case 'TRUSTED':
      return 0.8;
    case 'SPECIALIST':
      return 0.6;
    case 'COMMUNITY':
      return 0.4;
    case 'DISCOVERY':
      return 0.2;
    default:
      return 0.5; // Unknown tier: neutral
  }
}

/**
 * Build human-readable explanation of the ranking score.
 */
function buildExplanation(
  signals: RankingSignals,
  config: RankingConfig,
  baseScore: number,
  finalScore: number,
): string {
  const parts: string[] = [];

  parts.push(`Base score: ${baseScore.toFixed(3)}`);
  parts.push(
    `Freshness: ${signals.freshness.toFixed(2)} (weight: ${config.weights.freshness})`,
  );
  parts.push(
    `Source diversity: ${signals.sourceDiversity.toFixed(2)} (weight: ${config.weights.sourceDiversity})`,
  );
  parts.push(
    `Source authority: ${signals.sourceAuthority.toFixed(2)} (weight: ${config.weights.sourceAuthority})`,
  );
  parts.push(
    `Story activity: ${signals.storyActivity.toFixed(2)} (weight: ${config.weights.storyActivity})`,
  );
  parts.push(
    `Novelty: ${signals.novelty.toFixed(2)} (weight: ${config.weights.novelty})`,
  );

  if (signals.aiImportance !== null) {
    parts.push(
      `AI importance: ${signals.aiImportance.toFixed(2)} (weight: ${config.weights.aiImportance})`,
    );
  } else {
    parts.push(
      `AI importance: unavailable (weight: ${config.weights.aiImportance})`,
    );
  }

  if (signals.editorialAdjustment !== 0) {
    parts.push(
      `Editorial adjustment: ${signals.editorialAdjustment >= 0 ? '+' : ''}${signals.editorialAdjustment.toFixed(2)}`,
    );
  }

  parts.push(`Final score: ${finalScore.toFixed(3)}`);

  return parts.join('; ');
}
