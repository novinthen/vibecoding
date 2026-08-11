# Current Stage

# Stage 8 — Ranking, Trending & Editorial Prioritisation

## Status

**COMPLETE**

Stage 8 is now complete.

Stage 3 (News Ingestion Engine), Stage 4 (Admin & Editorial Operations), Stage 5
(Public Portal), Stage 5B (Multi-Publication Localisation), Stage 6 (AI
Intelligence), Stage 7 (Story Clustering & Canonical Intelligence), and Stage 8
(Ranking, Trending & Editorial Prioritisation) are complete.

Do not begin Stage 9 (Developer Intelligence), automated publishing, GitHub
ingestion, or Hacker News ingestion without explicit approval.

---

# Goal

Build a transparent, versioned ranking and editorial-prioritisation layer for
already-formed Stories. Ranking answers "Which Stories matter most right now?"
while clustering (Stage 7) answers "Are these Articles about the same event?"

```
Story (canonical)
  → derive ranking signals (freshness, source diversity, authority, activity, novelty, AI importance)
  → calculate deterministic score (versioned formula)
  → persist ranking evidence (versioned, append-only)
  → publication-aware editorial adjustment (featured, boost, suppress)
  → public ordering (top stories, topic pages)
```

## Core invariant

**Ranking NEVER alters Story membership.** Ranking is a separate layer that
scores existing Stories. It never clusters, merges, splits, attaches, or
detaches Articles. It never modifies Article source facts. It never
auto-publishes Stories.

---

# Implemented

1. **Ranking schema & provenance** — migration `0016` adds `story_rankings`
   table (versioned, append-only) and `suppress_ranking` column to
   `publication_stories` for editorial exclusion from ranked lists.

2. **Ranking service** (`src/ranking/ranking-service.ts`) — pure, deterministic
   formulas for 6 signals (freshness, source diversity, source authority, story
   activity, novelty, AI importance) combined via weighted sum + editorial
   adjustment. Formula version `ranking-score-v1` with explicit weights.

3. **Ranking engine** (`src/ranking/ranking-engine.ts`) — orchestration layer
   that gathers data from multiple repositories, calls the pure ranking service,
   and persists results. Supports caching (reuses recent ranking < 1 hour) and
   force recalculation.

4. **Ranking repository** (`src/domain/repositories/story-ranking-repository.ts`)
   — data access for rankings (create, find latest, list history, list top
   ranked Story IDs). Supports publication-aware queries with correct precedence:
   publication-specific ranking wins over canonical.

5. **Admin service** (`src/admin/ranking-admin-service.ts`) — authorized,
   audited ranking operations: trigger ranking, view history, batch rank
   Stories. All operations logged to `admin_audit_log`.

6. **Admin UI** (`src/app/admin/(dashboard)/stories/[id]/`) — ranking card on
   Story detail page shows current score, signal breakdown, version, timestamp,
   history (collapsible), and manual trigger button (authorized, audited).

7. **Public queries** (`src/ranking/public-ranking-queries.ts`) — ranked Story
   list queries for public portal. Joins with latest rankings, applies correct
   precedence (publication-specific wins), orders by score, excludes suppressed
   Stories.

8. **Public routes** — `/top` route displays top-ranked published Stories using
   `listPublishedStoriesRanked()`. Respects PublicationStory settings, excludes
   suppressed Stories. `/latest` remains chronological (unchanged).

9. **Tests** — 40 unit tests for ranking formulas (all passing), 9 integration
   tests covering all Stage 8 requirements (ranking persistence, precedence,
   isolation, suppression, invariants, concurrency). Full regression test suite
   (327 tests passing). TypeScript check passes, production build succeeds.

10. **Documentation** — README, DATA_MODEL, ADMIN, PUBLIC_PORTAL, ARCHITECTURE
    updated with Stage 8 sections. Implementation plans and technical summaries
    in `docs/STAGE_8_*.md`.

---

# Ranking Formula v1

```
score = (freshness × 0.30) +
        (sourceDiversity × 0.15) +
        (sourceAuthority × 0.15) +
        (storyActivity × 0.15) +
        (novelty × 0.10) +
        (aiImportance × 0.15) +
        editorialAdjustment
```

**Signals:**
- **Freshness** — exponential decay from `Story.last_activity_at` (half-life: 24h)
- **Source Diversity** — distinct Source count / 10 (capped at 1.0)
- **Source Authority** — weighted average by tier (PRIMARY=1.0 ... DISCOVERY=0.2)
- **Story Activity** — recent Article count in 7-day window / 10
- **Novelty** — exponential decay from `Story.created_at` (half-life: 72h)
- **AI Importance** — max `importance_score` from Stage 6 enrichments (graceful fallback)

**Editorial Adjustment:**
- Featured: +0.5
- Priority: `editorial_priority × 0.1`
- Suppressed: -1000 (excludes from ranked lists)

All signals normalized to [0, 1]; formula is deterministic (same inputs → same output).

---

# Important Invariants

- Ranking **never** mutates Article source facts, publishes, or alters Story
  membership.
- Ranking is **advisory and explainable** — every score component is recorded.
- Rankings are **versioned and append-only** — history is preserved.
- **Publication-aware** — same Story may have different rankings per Publication.
- **Precedence correct** — latest publication-specific ranking wins over canonical.
  A newer canonical ranking does NOT override an older publication-specific ranking.
- **Editorial overrides** are explicit and auditable (applied once in formula, not
  double-counted in SQL).
- Unpublished Stories **never** appear in public ranked lists.
- Ranking is **optional** — public rendering works without rankings (graceful fallback).

---

# Exit Criteria

Stage 8 is complete when:

- ✅ the ranking schema supports versioned, provenanced ranking with publication-awareness
- ✅ deterministic ranking formula is implemented and tested
- ✅ all signals (freshness, source diversity, authority, activity, novelty, AI importance) are defined and tested
- ✅ editorial prioritization works per Publication
- ✅ precedence is correct (publication-specific wins over canonical)
- ✅ no double-counting (editorial adjustment applied once in formula)
- ✅ admin can trigger ranking and view provenance
- ✅ admin UI shows ranking card on Story detail
- ✅ public portal uses ranking for Story ordering (where appropriate)
- ✅ /top route displays ranked Stories
- ✅ all tests pass (unit, integration, regressions)
- ✅ build succeeds
- ✅ documentation updated (README, DATA_MODEL, ADMIN, PUBLIC_PORTAL, ARCHITECTURE)
- ✅ no invariants violated (no clustering changes, no auto-publish, no Article mutations)

---

# HARD STOP

Do not begin Stage 9 (Developer Intelligence), automated publishing, GitHub
ingestion, or Hacker News ingestion without explicit approval. Do not merge to
`main` without review.

---

# What's Next

**Stage 9 — Developer Intelligence** (NOT YET APPROVED):
- GitHub repository tracking
- Release intelligence
- Star velocity
- Changelog monitoring
- Hacker News integration
- Tool profiles

Await explicit approval before beginning Stage 9.
