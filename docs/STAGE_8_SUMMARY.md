# Stage 8 — Ranking, Trending & Editorial Prioritisation

**Status:** IMPLEMENTATION IN PROGRESS  
**Branch:** `claude/stage-8-ranking-trending`  
**Date:** 2026-08-11

---

## Executive Summary

Stage 8 adds a transparent, versioned ranking layer that answers **"Which Stories matter most right now?"** through deterministic, explainable scoring. Ranking operates independently from clustering (Stage 7) and never alters Story membership, Article source facts, or auto-publishes Stories.

### Core Implementation

1. **Schema:** Separate `story_rankings` table with append-only versioned history
2. **Formula:** Deterministic weighted sum combining 6 signals + editorial adjustment
3. **Signals:** Freshness, source diversity, source authority, story activity, novelty, AI importance
4. **Publication-aware:** Rankings support per-publication editorial overrides
5. **Provenance:** Every ranking calculation is versioned, timestamped, and explainable

---

## Implementation Progress

### ✅ Completed Components

#### 1. Schema & Migration (`0016_story_ranking.sql`)
- Created `story_rankings` table with full provenance fields
- Added `suppress_ranking` to `publication_stories` for editorial exclusion
- Indexes for efficient querying (by story, by publication, by score)

#### 2. Domain Layer
- **Types:** `StoryRankingRow`, `RankingSignals`, `RankingConfig`, `RankingInput`, `RankingResult`
- **Repository:** `StoryRankingRepository` with full CRUD operations
- **Updated:** `PublicationStoryRow`, `PublicationStoryInput`, `PublicationStoryRepository`

#### 3. Ranking Service (`src/ranking/ranking-service.ts`)
Pure, deterministic formulas:
- `calculateFreshnessScore()` — exponential decay (half-life: 24h)
- `calculateSourceDiversityScore()` — distinct source count / 10
- `calculateSourceAuthorityScore()` — weighted by tier (PRIMARY=1.0 ... DISCOVERY=0.2)
- `calculateStoryActivityScore()` — recent articles in 7-day window
- `calculateNoveltyScore()` — time since Story formation (half-life: 72h)
- `calculateAiImportanceScore()` — max Stage 6 importance (graceful fallback if unavailable)
- `calculateEditorialAdjustment()` — publication-specific boost/suppress
- `calculateStoryRanking()` — weighted sum integration

**Formula v1 weights:**
- Freshness: 30%
- Source Diversity: 15%
- Source Authority: 15%
- Story Activity: 15%
- Novelty: 10%
- AI Importance: 15%

#### 4. Ranking Engine (`src/ranking/ranking-engine.ts`)
- Orchestrates data gathering from multiple repositories
- Calls pure ranking service
- Persists results via repository
- Caching: reuses recent ranking (< 1 hour, same version)
- Force flag: recalculate even if cached

#### 5. Admin Service (`src/admin/ranking-admin-service.ts`)
- `triggerRanking()` — authorized, audited manual trigger
- `getRankingHistory()` — provenance review
- `getCurrentRanking()` — latest ranking for Story
- `getRecentRankings()` — dashboard view
- `batchRankStories()` — bulk recalculation
- Audit actions: `STORY_RANKING_TRIGGER`, `STORY_RANKING_BATCH`

#### 6. Public Ranking Queries (`src/ranking/public-ranking-queries.ts`)
- `listPublishedStoriesRanked()` — homepage/trending with ranking order
- `listPublishedStoriesForTopicRanked()` — topic pages with ranking
- `countPublishedStoriesRanked()` — pagination support
- Applies editorial priority and excludes suppressed Stories

#### 7. Tests
- **Unit tests:** `tests/ranking/ranking-service.test.ts` (all formulas, determinism, edge cases)
- **Integration tests:** `tests/ranking/ranking.integration.test.ts` (persistence, caching, invariants)

---

## Remaining Work

### High Priority

1. **Admin UI Integration** (NOT STARTED)
   - Add ranking card to `/admin/stories/[id]`
   - Display: current score, signals breakdown, history, manual trigger
   - Authorization: mutating admins only
   - Audit log integration

2. **Public Portal Integration** (PARTIAL)
   - Update homepage to use `listPublishedStoriesRanked()`
   - Update Topic pages to use `listPublishedStoriesForTopicRanked()`
   - Keep `/latest` chronological (unchanged)
   - **Decision needed:** Implement honest trending OR rename to "Top Stories"

3. **Documentation Updates** (NOT STARTED)
   - `docs/CURRENT_STAGE.md` → Stage 8 complete
   - `docs/DATA_MODEL.md` → Add ranking schema/provenance
   - `docs/ADMIN.md` → Add ranking workflows
   - `docs/PUBLIC_PORTAL.md` → Add ranking ordering
   - `docs/ARCHITECTURE.MD` → Add ranking layer
   - `README.md` → Update to Stage 8

4. **Testing & Validation** (NOT STARTED)
   - Run migration `0016_story_ranking.sql`
   - Run all unit tests (ranking service)
   - Run all integration tests
   - Run Stage 3–7 regression tests
   - Run typecheck, lint, format
   - Run production build
   - Smoke test: rank Stories across two Publications

---

## Technical Decisions

### Why Separate `story_rankings` Table?
- **Append-only history:** Never overwrites previous rankings
- **Versioning:** Multiple ranking versions can coexist
- **Publication-aware:** Same Story can have different rankings per Publication
- **Clean separation:** Ranking is derived data, not canonical Story facts

### Why Weighted Sum Formula?
- **Deterministic:** Same inputs → same output (testable, reproducible)
- **Transparent:** Every component is explainable
- **Versioned:** Formula changes are auditable
- **Not opaque:** No black-box LLM scoring

### Why No Automatic Scheduling?
- **Stage 8 MVP:** Manual triggering keeps complexity bounded
- **Cost control:** Ranking is compute-intensive; manual control prevents runaway costs
- **Editorial oversight:** Admins see ranking before it affects public surfaces
- **Future stages:** Automatic scheduling can be added when monitoring/throttling are in place

---

## Ranking Formula Example

For a Story with:
- Last activity: 1 day ago → freshness = 0.5
- 3 distinct sources → diversity = 0.3
- 2 PRIMARY, 1 TRUSTED → authority = 0.93
- 2 articles in last 7 days → activity = 0.2
- Created 2 days ago → novelty = 0.63
- AI importance = 0.8 → 0.8
- Featured + priority 5 → editorial = +1.0

**Score calculation:**
```
base = (0.5 × 0.30) + (0.3 × 0.15) + (0.93 × 0.15) + (0.2 × 0.15) + (0.63 × 0.10) + (0.8 × 0.15)
     = 0.15 + 0.045 + 0.14 + 0.03 + 0.063 + 0.12
     = 0.548

final = 0.548 + 1.0 = 1.548
```

---

## Invariants Preserved

✅ Ranking NEVER alters Story membership (no clustering changes)  
✅ Ranking NEVER mutates Article source facts  
✅ Ranking NEVER auto-publishes a Story  
✅ PublicationStory remains the publishing boundary  
✅ Ranking is advisory and explainable  
✅ Editorial overrides are explicit and auditable  
✅ Unpublished Stories never appear in ranked public lists  

---

## Files Changed/Added

### New Files (14)
- `src/db/migrations/0016_story_ranking.sql`
- `src/domain/ranking-types.ts`
- `src/domain/repositories/story-ranking-repository.ts`
- `src/ranking/ranking-service.ts`
- `src/ranking/ranking-engine.ts`
- `src/ranking/public-ranking-queries.ts`
- `src/admin/ranking-admin-service.ts`
- `tests/ranking/ranking-service.test.ts`
- `tests/ranking/ranking.integration.test.ts`
- `docs/STAGE_8_PLAN.md`
- `docs/STAGE_8_STATUS.md`
- `docs/STAGE_8_SUMMARY.md` (this file)

### Modified Files (3)
- `src/domain/types.ts` — added `suppress_ranking` to `PublicationStoryRow`
- `src/domain/repositories/publication-story-repository.ts` — updated for `suppress_ranking`

---

## Next Steps

1. **Install dependencies:** `npm install` is running
2. **Run tests:** Verify ranking service works correctly
3. **Implement admin UI:** Ranking card in Story detail page
4. **Implement public integration:** Homepage and topic pages
5. **Update documentation:** All docs listed above
6. **Full validation:** Run complete test suite + build
7. **Smoke test:** Real data across two Publications
8. **Create completion report**
9. **Push to branch:** `claude/stage-8-ranking-trending`

---

## Estimated Completion

- **Core implementation:** 70% complete
- **Admin integration:** 50% complete (service done, UI pending)
- **Public integration:** 40% complete (queries done, routes pending)
- **Documentation:** 10% complete (plans written, formal docs pending)
- **Testing:** 60% complete (unit/integration tests written, not yet run)

**Remaining work:** 4–6 hours (admin UI, public routes, docs, full validation)

---

## Questions for Review

1. **Trending definition:** Implement honest velocity-based trending or defer to later stage?
2. **Weight tuning:** Are the v1 weights (freshness 30%, etc.) reasonable for MVP?
3. **Caching policy:** Is 1-hour cache window appropriate for manual triggering?
4. **Suppression semantics:** Should suppressed Stories still be accessible at their detail URL?

---

## Contact

This implementation follows the Stage 8 requirements from the user's prompt exactly:
- Transparent, versioned ranking
- Publication-aware editorial prioritization
- No clustering changes, no auto-publishing
- Deterministic, explainable formulas
- Full provenance and audit trail
