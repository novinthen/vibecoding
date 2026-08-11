/**
 * Stage 8 — Story Ranking types.
 *
 * Ranking answers "Which Stories matter most right now?" through transparent,
 * versioned scoring. Ranking NEVER alters Story membership, Article source facts,
 * or auto-publishes Stories.
 */

/**
 * One ranking calculation result (one row in story_rankings). Each ranking is
 * versioned and append-only: re-ranking a Story creates a new row rather than
 * overwriting the previous one, so ranking history is preserved.
 */
export interface StoryRankingRow {
  id: string;
  story_id: string;
  publication_id: string | null;
  ranking_method: string;
  ranking_version: string;
  calculated_score: number;
  signals: RankingSignals;
  calculated_at: string;
  time_horizon: string | null;
  explanation: string | null;
  created_at: string;
}

/**
 * Component signals that contribute to a ranking score. All signals are
 * normalized to [0, 1] (or [-∞, +∞] for editorial adjustments). This structure
 * is stored as JSONB in the database for transparency and debugging.
 */
export interface RankingSignals {
  /** Time decay from Story.last_activity_at (0 = very old, 1 = just now). */
  freshness: number;
  /** Distinct Source count across StoryArticles, normalized (0 = 1 source, 1 = many). */
  sourceDiversity: number;
  /** Weighted average of Source authority tiers (0 = DISCOVERY, 1 = PRIMARY). */
  sourceAuthority: number;
  /** Recent Article activity (0 = no recent articles, 1 = high velocity). */
  storyActivity: number;
  /** Time since Story formation (0 = old, 1 = very new). */
  novelty: number;
  /** AI importance score from Stage 6 enrichments (0 = low, 1 = high; null if unavailable). */
  aiImportance: number | null;
  /** Editorial priority from PublicationStory (can be negative for suppression). */
  editorialAdjustment: number;
  /** Publication-specific context (null for canonical/global rankings). */
  publicationContext?: {
    featured: boolean;
    editorialPriority: number;
    suppressRanking: boolean;
  } | null;
}

/**
 * Versioned ranking configuration. Weights and parameters are explicit and
 * named so formula changes are auditable across versions.
 */
export interface RankingConfig {
  version: string;
  weights: {
    freshness: number;
    sourceDiversity: number;
    sourceAuthority: number;
    storyActivity: number;
    novelty: number;
    aiImportance: number;
  };
  /** Freshness decay half-life in hours (score halves after this duration). */
  freshnessHalfLifeHours: number;
  /** Expected maximum distinct Sources for normalization (10 = very well-covered). */
  maxExpectedSources: number;
  /** Activity window in hours (count recent Articles within this window). */
  activityWindowHours: number;
  /** Novelty decay half-life in hours (new Stories score higher). */
  noveltyHalfLifeHours: number;
  /** Editorial priority scaling factor (multiply raw priority by this). */
  editorialPriorityScale: number;
  /** Featured boost: additional score when PublicationStory.featured = true. */
  featuredBoost: number;
}

/**
 * Result of ranking calculation before persistence. Includes the final score,
 * component signals, and an explanation for transparency.
 */
export interface RankingResult {
  score: number;
  signals: RankingSignals;
  explanation: string;
  method: string;
  version: string;
  timeHorizon: string | null;
}

/**
 * Input data for ranking a Story. Gathered from multiple repositories and
 * passed to the pure ranking service.
 */
export interface RankingInput {
  story: {
    id: string;
    lastActivityAt: Date | null;
    createdAt: Date;
  };
  /** Articles belonging to the Story with their source facts. */
  articles: Array<{
    id: string;
    sourceId: string;
    publishedAt: Date | null;
    discoveredAt: Date;
  }>;
  /** Distinct Sources across the Story's Articles with authority tiers. */
  sources: Array<{
    id: string;
    authorityTier: string;
  }>;
  /** Stage 6 enrichments (may be empty if enrichment is unavailable). */
  enrichments: Array<{
    articleId: string;
    importanceScore: number | null;
    status: string;
  }>;
  /** Publication-specific editorial context (null for canonical ranking). */
  publicationContext?: {
    featured: boolean;
    editorialPriority: number;
    suppressRanking: boolean;
  } | null;
  /** Reference time for freshness/novelty calculations (defaults to now). */
  referenceTime?: Date;
}

/**
 * A Story with its latest ranking for display/sorting. Used in public and
 * admin list views.
 */
export interface StoryWithRanking {
  story: {
    id: string;
    slug: string;
    canonicalTitle: string;
    status: string;
    lastActivityAt: string | null;
  };
  ranking: {
    score: number;
    calculatedAt: string;
    method: string;
    version: string;
  } | null;
  /** Publication-specific editorial state (for publication-aware views). */
  publicationState?: {
    featured: boolean;
    editorialPriority: number;
    suppressRanking: boolean;
  } | null;
}
