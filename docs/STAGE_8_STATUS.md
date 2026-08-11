# Stage 8 Implementation Status

## Completed ✅

### 1. Core Architecture & Planning
- ✅ Implementation plan documented (`docs/STAGE_8_PLAN.md`)
- ✅ Schema design finalized (separate `story_rankings` table)
- ✅ Migration created (`0016_story_ranking.sql`)
- ✅ Domain types defined (`src/domain/ranking-types.ts`)

### 2. Domain Layer
- ✅ `StoryRankingRepository` implemented with methods:
  - `create()` — persist ranking
  - `findLatestForStory()` — latest ranking for one Story
  - `findLatestForStories()` — batch lookup
  - `listRecent()` — recent rankings across all Stories
  - `listHistoryForStory()` — provenance history
  - `listTopRankedStoryIds()` — public ordering query
- ✅ `PublicationStoryRow` extended with `suppress_ranking` field
- ✅ `PublicationStoryRepository` updated for suppress_ranking
- ✅ `PublicationStoryInput` updated

### 3. Ranking Service (Pure Formulas)
- ✅ `src/ranking/ranking-service.ts` with deterministic formulas:
  - `calculateFreshnessScore()` — exponential decay
  - `calculateSourceDiversityScore()` — distinct source count
  - `calculateSourceAuthorityScore()` — weighted authority
  - `calculateStoryActivityScore()` — recent article velocity
  - `calculateNoveltyScore()` — time since formation
  - `calculateAiImportanceScore()` — Stage 6 importance (graceful fallback)
  - `calculateEditorialAdjustment()` — publication-specific overrides
  - `calculateStoryRanking()` — complete weighted-sum integration
- ✅ `RANKING_CONFIG_V1` with versioned weights and parameters

### 4. Ranking Engine (Orchestration)
- ✅ `src/ranking/ranking-engine.ts`:
  - `rankStory()` — gather data, calculate, persist
  - `rankStories()` — batch ranking
  - `gatherRankingInput()` — fetch all required data
  - Caching: reuses recent ranking (< 1 hour, same version)
  - Force flag: recalculate even if cached

### 5. Tests
- ✅ Unit tests (`tests/ranking/ranking-service.test.ts`):
  - All signal formulas tested individually
  - Integration test for complete ranking
  - Determinism verified
  - Editorial adjustment tested
  - Graceful AI-importance fallback tested
- ✅ Integration tests (`tests/ranking/ranking.integration.test.ts`):
  - Persistence verification
  - Caching behavior
  - Publication-aware ranking
  - Multiple stories
  - Invariant preservation (no clustering changes, no Article mutations)

## Remaining Work 🚧

### 6. Admin Integration (HIGH PRIORITY)
- ⬜ Admin ranking service (`src/admin/ranking-admin-service.ts`)
  - Trigger ranking for one Story (authorized, audited)
  - View ranking history
  - View signal breakdown
- ⬜ Admin UI: Story detail ranking card (`/admin/stories/[id]`)
  - Display current ranking score
  - Component signals breakdown (table/chart)
  - Ranking method/version
  - Calculated timestamp
  - Ranking history (collapsible)
  - Manual trigger button (mutating admins only)
  - Audit log integration
- ⬜ Admin audit actions:
  - `STORY_RANKING_TRIGGER` action
  - Record: Story ID, publication ID, method/version, resulting score
- ⬜ Admin tests (`tests/admin/ranking-admin.integration.test.ts`)
  - Mutating admin can trigger ranking
  - VIEWER cannot trigger ranking
  - Ranking history retrieval
  - Audit log records

### 7. Public Portal Integration (HIGH PRIORITY)
- ⬜ Update `PublicContentRepository`:
  - `listPublishedStoriesRanked()` — join with latest rankings
  - Apply editorial priority from `publication_stories`
  - Filter out `suppress_ranking = true`
  - Order by final score DESC
- ⬜ Update homepage to use ranked ordering
- ⬜ Update Topic pages to use ranked ordering
- ⬜ Keep `/latest` chronological (unchanged)
- ⬜ Trending page:
  - **Decision needed:** Implement honest velocity-based trending OR defer
  - If deferred: rename to "Top Stories" or similar
  - Document what "trending" means if implemented
- ⬜ Public tests (`tests/public/ranking.integration.test.ts`)
  - Ranked list respects PublicationStory editorial priority
  - Unpublished Story not in ranked list
  - Featured Story appears higher
  - Suppressed Story excluded
  - `/latest` remains chronological

### 8. Documentation Updates (HIGH PRIORITY)
- ⬜ `docs/CURRENT_STAGE.md` → Update to Stage 8 complete
- ⬜ `docs/DATA_MODEL.md` → Add `story_rankings`, ranking provenance
- ⬜ `docs/ADMIN.md` → Add ranking review/trigger workflows
- ⬜ `docs/PUBLIC_PORTAL.md` → Add ranked ordering, trending definition
- ⬜ `docs/ARCHITECTURE.MD` → Add ranking layer section
- ⬜ `README.md` → Update current stage to Stage 8

### 9. Testing & Validation (CRITICAL)
- ⬜ Run migration `0016_story_ranking.sql`
- ⬜ Run all unit tests (ranking service)
- ⬜ Run all integration tests (ranking, admin, public)
- ⬜ Run Stage 3–7 regression tests (ensure no breakage)
- ⬜ Run typecheck
- ⬜ Run lint
- ⬜ Run format check
- ⬜ Run production build
- ⬜ Smoke test: Rank multiple Stories across two Publications

### 10. Final Review & Completion Checklist
- ⬜ Verify no clustering membership mutations
- ⬜ Verify no auto-publishing
- ⬜ Verify no fake engagement data
- ⬜ Verify no unexplained magic constants
- ⬜ Verify no cross-Publication ranking leakage
- ⬜ Verify no unpublished Story exposure
- ⬜ Verify no lost ranking provenance
- ⬜ Verify no unauthorized editorial overrides
- ⬜ Verify no Stage 9 scope creep
- ⬜ Create Stage 8 completion report
- ⬜ Commit and push to `claude/stage-8-ranking-trending` branch

## Architecture Decisions Made

1. **Schema:** Separate `story_rankings` table (append-only, versioned)
2. **Formula:** Deterministic weighted sum of 6 signals + editorial adjustment
3. **Weights (v1):**
   - Freshness: 30%
   - Source Diversity: 15%
   - Source Authority: 15%
   - Story Activity: 15%
   - Novelty: 10%
   - AI Importance: 15%
4. **Publication-awareness:** Rankings can be per-publication or global; editorial overrides are per-publication via `publication_stories`
5. **Trending:** Deferred until public integration (decision needed)
6. **Recalculation:** Manual/bounded for Stage 8; no automatic scheduling
7. **Config:** Versioned code constants (`RANKING_CONFIG_V1`)
8. **History:** Append-only ranking history for provenance/debugging

## Known Issues / Notes

- Dependencies need to be installed (`npm install` is running)
- Tests written but not yet run (waiting for dependencies)
- Admin UI components not yet created
- Public portal integration pending
- Trending definition pending (honest velocity-based or defer)

## Next Steps

1. Wait for `npm install` to complete
2. Run tests to verify ranking service
3. Implement admin integration (service + UI + tests)
4. Implement public portal integration (repository + routes + tests)
5. Update all documentation
6. Run full test suite + build
7. Smoke test with real data
8. Create completion report
