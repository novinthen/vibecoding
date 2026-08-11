# Stage 8 Implementation Plan — Ranking, Trending & Editorial Prioritisation

## Status: PLANNING

This document captures the implementation plan for Stage 8 before any code is written.

## Core Distinction

**Clustering (Stage 7):** "Are these Articles about the same event?"
**Ranking (Stage 8):** "Which Stories matter most right now?"

Ranking NEVER alters Story membership, Article source facts, or auto-publishes Stories.

## Architecture Overview

```
Story (canonical)
  ↓
Derive ranking signals (freshness, source diversity, authority, novelty, AI importance)
  ↓
Calculate deterministic score (versioned formula)
  ↓
Persist ranking evidence (versioned, append-only where practical)
  ↓
Publication-specific editorial adjustment (featured, boost, suppress)
  ↓
Public ordering (homepage, trending, topic pages)
```

## Schema Design

### Option A: Separate `story_rankings` table (RECOMMENDED)

```sql
CREATE TABLE story_rankings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id              uuid NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  ranking_method        text NOT NULL,
  ranking_version       text NOT NULL,
  calculated_score      double precision NOT NULL,
  -- Component signals (JSONB for flexibility)
  signals               jsonb NOT NULL,
  -- Time context
  calculated_at         timestamptz NOT NULL DEFAULT now(),
  time_horizon          text,  -- e.g., "24h", "7d", "trending-window"
  -- Optional: publication-specific if scores vary by publication
  publication_id        uuid REFERENCES publications (id) ON DELETE CASCADE,
  -- Explanation for transparency
  explanation           text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX story_rankings_story_id_idx ON story_rankings (story_id);
CREATE INDEX story_rankings_score_idx ON story_rankings (calculated_score DESC);
CREATE INDEX story_rankings_calculated_at_idx ON story_rankings (calculated_at DESC);
CREATE INDEX story_rankings_method_version_idx 
  ON story_rankings (ranking_method, ranking_version);

-- For publication-aware queries
CREATE INDEX story_rankings_pub_score_idx 
  ON story_rankings (publication_id, calculated_score DESC);
```

**Rationale:** Append-only history, versioning, publication-aware ranking, clear separation from canonical Story facts.

### Option B: Add ranking fields directly to `stories` table

```sql
ALTER TABLE stories
  ADD COLUMN ranking_score double precision,
  ADD COLUMN ranking_method text,
  ADD COLUMN ranking_version text,
  ADD COLUMN ranking_signals jsonb,
  ADD COLUMN ranking_calculated_at timestamptz;
```

**Downsides:** No history, no publication-specific scores, overwrites previous ranking.

**Decision:** Use Option A (separate table) for provenance, versioning, and publication-awareness.

### Extend `publication_stories` with editorial controls

The existing `publication_stories.editorial_priority` (numeric) and `publication_stories.featured` (boolean) are already suitable for editorial overrides. We may add:

```sql
ALTER TABLE publication_stories
  ADD COLUMN editorial_boost double precision DEFAULT 0,
  ADD COLUMN suppress_ranking boolean DEFAULT false;
```

Or we can use the existing `editorial_priority` as the boost/penalty and `featured` as a pin.

## Ranking Formula — Version 1

Initial deterministic formula: `ranking-score-v1`

```typescript
score = 
  (freshness_score * FRESHNESS_WEIGHT) +
  (source_diversity_score * SOURCE_DIVERSITY_WEIGHT) +
  (source_authority_score * SOURCE_AUTHORITY_WEIGHT) +
  (story_activity_score * ACTIVITY_WEIGHT) +
  (novelty_score * NOVELTY_WEIGHT) +
  (ai_importance_score * AI_IMPORTANCE_WEIGHT) +
  (editorial_priority_adjustment)
```

### Signal Definitions

1. **Freshness Score** (0–1)
   - Time decay from `Story.last_activity_at` or most recent Article
   - Decay curve: exponential with configurable half-life (e.g., 24 hours)
   - Reference: current time
   - Version: `fresh-decay-v1`

2. **Source Diversity Score** (0–1)
   - Count of distinct Sources across StoryArticles
   - Normalize: `min(distinct_sources / MAX_EXPECTED_SOURCES, 1.0)`
   - Defend against: same-source duplication inflating score

3. **Source Authority Score** (0–1)
   - Weighted average of Source authority tiers
   - Mapping: PRIMARY=1.0, TRUSTED=0.8, SPECIALIST=0.6, COMMUNITY=0.4, DISCOVERY=0.2
   - Consider: highest authority Source, or weighted average

4. **Story Activity Score** (0–1)
   - Number of Articles in time window (e.g., last 7 days)
   - Velocity: new Articles per unit time
   - Normalize to 0–1 range

5. **Novelty Score** (0–1)
   - Time since Story formation (`Story.created_at`)
   - Recent Stories score higher (but not the only factor)
   - Optional: use Stage 6 AI novelty if available

6. **AI Importance Score** (0–1)
   - From Stage 6 `ArticleEnrichment.importance_score` if available
   - Aggregate across Story's Articles (max, average, or weighted)
   - Graceful fallback if enrichment is missing

7. **Editorial Priority Adjustment** (-∞ to +∞)
   - From `PublicationStory.editorial_priority`
   - Featured stories: significant boost
   - Suppressed stories: large penalty or exclude entirely

### Weight Configuration (v1)

Store in code as a versioned config object:

```typescript
const RANKING_CONFIG_V1 = {
  version: 'ranking-score-v1',
  weights: {
    freshness: 0.30,
    sourceDiversity: 0.15,
    sourceAuthority: 0.15,
    storyActivity: 0.15,
    novelty: 0.10,
    aiImportance: 0.15,
  },
  freshnessHalfLife: '24h',
  maxExpectedSources: 10,
  activityWindow: '7d',
};
```

## Implementation Order

### 1. Migration: `0016_story_ranking.sql`

- Create `story_rankings` table
- Optionally extend `publication_stories` with editorial controls
- Add indexes

### 2. Domain Types: `src/domain/ranking-types.ts`

Define:
- `StoryRankingRow`
- `RankingSignals` interface
- `RankingConfig` interface
- Utility types

### 3. Repository: `src/domain/repositories/story-ranking-repository.ts`

Methods:
- `create(ranking): Promise<StoryRankingRow>`
- `findLatestForStory(storyId, publicationId?): Promise<StoryRankingRow | null>`
- `findLatestForStories(storyIds, publicationId?): Promise<Map<string, StoryRankingRow>>`
- `listRecentRankings(limit, publicationId?): Promise<StoryRankingRow[]>`
- `listRankingHistory(storyId, limit): Promise<StoryRankingRow[]>`

### 4. Ranking Service: `src/ranking/ranking-service.ts`

Pure, deterministic scoring:
- `calculateFreshnessScore(lastActivityAt: Date, now: Date, config): number`
- `calculateSourceDiversityScore(distinctSources: number, config): number`
- `calculateSourceAuthorityScore(sources: Source[], config): number`
- `calculateStoryActivityScore(recentArticleCount: number, config): number`
- `calculateNoveltyScore(storyCreatedAt: Date, now: Date, config): number`
- `calculateAiImportanceScore(enrichments: ArticleEnrichment[], config): number`
- `calculateStoryRankingScore(story: Story, articles: Article[], sources: Source[], enrichments: ArticleEnrichment[], config): RankingResult`

### 5. Ranking Engine: `src/ranking/ranking-engine.ts`

Orchestration:
- `rankStory(storyId, publicationId?, force?): Promise<StoryRankingRow>`
- `rankStories(storyIds, publicationId?): Promise<StoryRankingRow[]>`
- Fetch Story + Articles + Sources + Enrichments
- Call ranking service
- Persist result via repository
- Return ranking row

### 6. Publication-Aware Ranking: `src/ranking/publication-ranking.ts`

Combine canonical ranking + editorial overrides:
- `getPublicationRankingScore(storyId, publicationId): Promise<number>`
- Apply editorial boost/suppress from `PublicationStory`
- Return final score for public ordering

### 7. Admin Service: `src/admin/ranking-admin-service.ts`

Admin operations:
- Trigger ranking recalculation (bounded, manual)
- View ranking history for a Story
- View component signals
- Update editorial priority (already exists via PublicationStory)

### 8. Admin UI: `/admin/stories/[id]` — Add Ranking Card

Display:
- Current ranking score
- Component signals breakdown
- Ranking method/version
- Calculated at timestamp
- Ranking history (recent versions)
- Manual trigger button (mutating admins only)

### 9. Public Integration: Update `PublicContentRepository`

Modify Story list queries to order by ranking:
- Homepage: top-ranked published Stories
- `/trending`: if we define it honestly, else defer
- Topic pages: ranked Stories within topic
- Keep `/latest` chronological (unchanged)

Methods:
- `listPublishedStoriesRanked(publicationId, limit, offset): Promise<StoryWithRanking[]>`
- Join with latest `story_rankings` for publication
- Apply editorial priority from `publication_stories`
- Order by final score DESC

### 10. Trending Definition

**Honest Trending:** Only implement if we can define it truthfully from existing data.

Option A: **Velocity-based trending**
- Recent Story activity (new Articles in last 6–24h)
- Weighted by source diversity and authority
- Recency-adjusted (fresher = more trending)
- Distinct from "Top" (which is overall importance)

Option B: **Defer Trending**
- Keep "Top" or "Priority" as the ranked surface
- Do not label simple time-ordering as "Trending"
- Implement Trending in a later stage with real momentum signals

**Decision:** Start with Option A (honest velocity-based trending) only if signal is defensible. Otherwise defer.

### 11. Documentation

Update:
- `docs/CURRENT_STAGE.md` → Stage 8 complete
- `docs/DATA_MODEL.md` → Add `story_rankings`, ranking provenance
- `docs/ADMIN.md` → Add ranking review/trigger workflows
- `docs/PUBLIC_PORTAL.md` → Add ranked ordering, trending definition
- `docs/ARCHITECTURE.MD` → Add ranking layer
- `README.md` → Update current stage

## Testing Strategy

### Unit Tests: `tests/ranking/ranking-service.test.ts`

- Pure formula tests (deterministic inputs → expected scores)
- Freshness decay curve
- Source diversity (1 vs 5 vs 10 sources)
- Authority weighting (PRIMARY vs COMMUNITY)
- Duplicate same-Source Articles don't inflate diversity
- Novelty curve
- AI importance absent → graceful fallback (0 or neutral score)
- Editorial boost/suppress application
- Deterministic: same inputs + version → same score

### Integration Tests: `tests/ranking/ranking.integration.test.ts`

- Rank a Story with real DB records
- Publication A and Publication B rank same Story differently (editorial priority)
- Unpublished Story has ranking but never appears publicly
- Ranking re-run is idempotent (same version → no duplicate)
- Ranking does not alter Story membership
- Ranking does not alter Article source facts
- Concurrent ranking writes are safe

### Admin Tests: `tests/admin/ranking-admin.integration.test.ts`

- Mutating admin triggers ranking
- VIEWER cannot trigger ranking
- Ranking history retrieval
- Audit log records ranking trigger

### Public Tests: `tests/public/ranking.integration.test.ts`

- Ranked Story list respects PublicationStory editorial priority
- Unpublished Story not in ranked list
- Featured Story appears higher
- Suppressed Story excluded or de-ranked
- `/latest` remains chronological (unchanged)

## Scope Boundaries — NOT Stage 8

- Recommendation/personalization
- User profiles
- Collaborative filtering
- Page-view analytics
- Social media engagement ingestion
- Automated publishing
- New Story clustering
- Automatic Story merges/splits
- Automated translation
- GitHub ingestion
- Hacker News ingestion
- Alerts, comments, payments

## Completion Checklist

- [ ] Migration `0016_story_ranking.sql` created and tested
- [ ] Domain types defined
- [ ] StoryRankingRepository implemented
- [ ] Ranking service (pure formulas) implemented
- [ ] Ranking engine (orchestration) implemented
- [ ] Publication-aware ranking service implemented
- [ ] Admin ranking service implemented
- [ ] Admin UI ranking card added to Story detail
- [ ] Public portal integration (ranked lists) implemented
- [ ] Trending defined honestly or deferred
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] All Stage 3–7 regression tests pass
- [ ] Typecheck passes
- [ ] Lint passes
- [ ] Format check passes
- [ ] Production build succeeds
- [ ] Smoke test: rank multiple Stories across two Publications
- [ ] Documentation updated
- [ ] No clustering membership mutations
- [ ] No auto-publishing
- [ ] No fake engagement data
- [ ] No unexplained magic constants
- [ ] No cross-Publication ranking leakage
- [ ] No unpublished Story exposure
- [ ] No lost ranking provenance
- [ ] No unauthorized editorial overrides
- [ ] No Stage 9 scope creep

## Exit Criteria

Stage 8 is complete when:

1. Schema supports versioned, provenanced ranking with publication-awareness
2. Deterministic ranking formula is implemented and tested
3. All signals (freshness, source diversity, authority, activity, novelty, AI importance) are defined and tested
4. Editorial prioritization works per Publication
5. Admin can review ranking provenance and trigger recalculation
6. Public portal uses ranking for Story ordering (where appropriate)
7. Trending is defined honestly or explicitly deferred
8. All tests pass (unit, integration, regressions)
9. Build succeeds
10. Smoke test confirms ranking works across two Publications
11. Documentation is updated
12. No invariants violated (no clustering changes, no auto-publish, no Article mutations)

## Risks & Mitigations

1. **Risk:** Ranking formula is arbitrary/unjustified
   - **Mitigation:** Document rationale for each signal and weight; make formula inspectable

2. **Risk:** Cross-Publication ranking leakage
   - **Mitigation:** Publication-aware ranking table with proper isolation

3. **Risk:** Editorial overrides become opaque
   - **Mitigation:** Audit log, clear UI showing base score + adjustment

4. **Risk:** "Trending" becomes fake
   - **Mitigation:** Only implement if honestly defined from real signals; otherwise defer

5. **Risk:** Ranking becomes required for public rendering
   - **Mitigation:** Graceful fallback to chronological if ranking unavailable

## Decision Log

- **Schema:** Separate `story_rankings` table (versioned, append-only)
- **Formula:** Deterministic weighted sum of 6 signals + editorial adjustment
- **Publication-awareness:** Rankings can be per-publication or global; editorial overrides are per-publication
- **Trending:** Defer unless we can define it honestly from existing data
- **Recalculation:** Manual/bounded for Stage 8; no automatic scheduling
- **Config:** Store formula weights as versioned code constants
- **History:** Keep ranking history for provenance/debugging

