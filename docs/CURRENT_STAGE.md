# Stage 8 — Story Clustering & Canonical Intelligence

## Status

**COMPLETE**

Stage 8 — Ranking, Trending & Editorial Prioritisation is now complete.

This file defines the only implementation scope currently approved.

Stage 3 (News Ingestion Engine), Stage 4 (Admin & Editorial Operations), Stage 5
(Public Portal), Stage 5B (Multi-Publication Localisation), Stage 6 (AI
Intelligence), and Stage 7 (Story Clustering & Canonical Intelligence) are complete.

Do not begin Stage 9 (Developer Intelligence), automated publishing, GitHub
ingestion, or Hacker News ingestion without explicit approval.

---

# Stage 8 — Ranking, Trending & Editorial Prioritisation

## Goal

Build a transparent, versioned ranking and editorial-prioritisation layer for
already-formed Stories. Ranking answers "Which Stories matter most right now?"
while clustering (Stage 7) answers "Are these Articles about the same event?"

```
Story (canonical)
  → derive ranking signals (freshness, source diversity, authority, activity, novelty, AI importance)
  → calculate deterministic score (versioned formula)
  → persist ranking evidence (versioned, append-only)
  → publication-aware editorial adjustment (featured, boost, suppress)
  → public ordering (homepage, topic pages, top stories)
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
   ranked Story IDs). Supports publication-aware queries.

5. **Admin service** (`src/admin/ranking-admin-service.ts`) — authorized,
   audited ranking operations: trigger ranking, view history, batch rank
   Stories. All operations logged to `admin_audit_log`.

6. **Public queries** (`src/ranking/public-ranking-queries.ts`) — ranked Story
   list queries for public portal (homepage, topic pages). Joins with latest
   rankings, applies editorial priority, excludes suppressed Stories.

7. **Tests** — 40 unit tests for ranking formulas (all passing), plus full
   regression test suite (327 tests passing). TypeScript check passes, production
   build succeeds.

8. **Documentation** — implementation plan, status tracking, technical summary,
   and completion report in `docs/STAGE_8_*.md`.

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
- **Editorial overrides** are explicit and auditable.
- Unpublished Stories **never** appear in public ranked lists.
- Ranking is **optional** — public rendering works without rankings (falls back
  to chronological).

---

# Exit Criteria

Stage 8 is complete when:

- the ranking schema supports versioned, provenanced ranking with publication-awareness ✅
- deterministic ranking formula is implemented and tested ✅
- all signals (freshness, source diversity, authority, activity, novelty, AI importance) are defined and tested ✅
- editorial prioritization works per Publication ✅
- admin can trigger ranking and view provenance ✅
- public portal uses ranking for Story ordering (where appropriate) ✅
- all tests pass (unit, integration, regressions) ✅
- build succeeds ✅
- no invariants violated (no clustering changes, no auto-publish, no Article mutations) ✅

---

# HARD STOP

Do not begin Stage 9 (Developer Intelligence), automated publishing, GitHub
ingestion, or Hacker News ingestion without explicit approval. Do not merge to
`main` without review.

---

# What's Next

**Optional Stage 8 enhancements:**
- Automatic ranking scheduling (Inngest job for periodic re-ranking)
- Admin UI ranking card (Story detail page)
- Trending page (honest velocity-based definition)

**Stage 9 — Developer Intelligence** (NOT YET APPROVED):
- GitHub repository tracking
- Release intelligence
- Star velocity
- Changelog monitoring
- Hacker News integration
- Tool profiles

Await explicit approval before beginning Stage 9.
