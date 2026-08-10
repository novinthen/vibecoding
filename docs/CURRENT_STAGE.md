# Current Stage

# Stage 7 — Story Clustering & Canonical Intelligence

## Status

**ACTIVE**

This file defines the only implementation scope currently approved.

Stage 3 (News Ingestion Engine), Stage 4 (Admin & Editorial Operations), Stage 5
(Public Portal), Stage 5B (Multi-Publication Localisation), and Stage 6 (AI
Intelligence) are complete. Do not begin Stage 8 (Ranking/Trending), automated
publishing, GitHub ingestion, or Hacker News ingestion.

---

# Goal

Build the first trustworthy **Story clustering** layer: group Articles that
describe the same underlying event/update into canonical Stories while preserving
every Article as independent evidence.

```
Articles
  → candidate generation (bounded, explainable)
  → similarity / evidence scoring (deterministic, versioned)
  → cluster decision (conservative)
  → Story
  → StoryArticles
  → reviewable clustering provenance
```

## Core invariant

**Article ≠ Story.** A Story is a canonical grouping of evidence. Clustering
never merges, rewrites, deletes, or mutates source Article facts. It biases to
**false split > false merge**: when uncertain whether two Articles describe the
same event, they are kept separate.

---

# Implemented

1. **Clustering schema & provenance** — migration `0015` extends embeddings with
   provider/version/content-hash provenance, adds Story `review_state`
   (UNREVIEWED/REVIEWED/LOCKED) + `formation_source` + clustering method/version,
   adds explainable provenance columns to `story_articles` (score, reason,
   signals, method/version), and adds a new append-only `clustering_decisions`
   log. No column is added to `articles` — source facts stay immutable.
2. **Embedding provider boundary** (`src/clustering/embedding`) — a provider-
   neutral `EmbeddingProvider` interface mirroring the Stage 6 AI boundary. A
   deterministic `FakeEmbeddingProvider` (feature hashing) is the only provider;
   it needs no network, so required CI is fully offline and reproducible. A real
   provider is a drop-in. Embeddings are derived data, versioned/provenanced, and
   never written into Article source fields; `ensureArticleEmbedding` reuses a
   stored vector when the model/version and source-content hash are unchanged.
3. **Candidate generation** (`src/clustering/candidates.ts`) — bounded and
   explainable: embedding nearest-neighbours (pgvector `<=>`, exact within a
   window) plus shared-Entity Stories, each capped and time-windowed, unioned and
   trimmed. Never an all-pairs comparison; each candidate records which signal
   surfaced it.
4. **Similarity scoring** (`src/clustering/scoring.ts`) — a pure, deterministic,
   versioned multi-signal formula (`cluster-score-v1`): weighted embedding
   similarity, title-token overlap, shared entities, and temporal proximity, with
   a hard evidence gate, a conservative assign threshold, and an ambiguity margin.
   Not an opaque LLM decision.
5. **Assignment engine** (`src/clustering/assignment.ts`) — ensure embedding →
   candidates → score → conservative decision → apply under a per-Article advisory
   lock → append an auditable decision. Outcomes: CREATED_STORY, ASSIGNED_EXISTING,
   AMBIGUOUS (no merge), SKIPPED_EXISTING (idempotent re-run), SKIPPED_PROTECTED
   (REVIEWED/LOCKED Story). Idempotent and concurrency-safe.
6. **Story lifecycle** — a newly formed Story is DRAFT + UNREVIEWED (internal/
   reviewable). Clustering never publishes; PublicationStory remains the explicit
   publishing boundary. `canonical_title` is a provisional, evidence-based value
   seeded from the primary Article, with full provenance in `clustering_decisions`.
7. **Admin review surface** — a Stories list and detail view (members, candidate
   scores, decision reasons/signals, method/version, confidence, source diversity,
   timestamps) plus an Article "Story clustering" card. Justified, authorized,
   **audited** operations: run clustering, attach, detach, create Story from
   Article, move between Stories, set review state. VIEWERs are refused.
8. **Public isolation** — the public portal is unchanged; only genuinely
   published PublicationStories are public. Clustering scores/review states are
   never exposed publicly, and clustering being unavailable does not affect
   ingestion, admin, or public rendering.

See [`docs/ARCHITECTURE.MD`](ARCHITECTURE.MD) (Clustering Architecture),
[`docs/DATA_MODEL.md`](DATA_MODEL.md), and [`docs/ADMIN.md`](ADMIN.md).

---

# Do Not Implement

- Ranking / trending / importance scoring; recommendation systems;
- automated publishing; automatic promotion of a Story to any Publication;
- autonomous merging/splitting of **reviewed** Stories;
- a full Story summarization pipeline; automated translation;
- GitHub ingestion; Hacker News ingestion; user personalization; alerts;
  comments; payments;
- new queueing/search/database infrastructure; production clustering scheduling.

---

# Important Invariants

- Clustering **never** mutates Article source facts, publishes, deletes Article
  evidence, or silently merges two reviewed Stories.
- Bias to **false split > false merge**: a hard evidence gate, a conservative
  threshold, and an AMBIGUOUS (no-merge) outcome for close calls.
- Re-running clustering is idempotent: it never creates a duplicate Story or a
  duplicate (story, article) link, and an already-clustered Article is a no-op.
- Embeddings are derived data with explicit provider/version provenance; a model/
  version change is distinguishable and never destroys prior decision provenance.
- REVIEWED/LOCKED Stories are protected from automatic restructuring; only
  explicit, audited admin operations may change them.
- Clustering is optional: with no embedding provider change, everything else
  behaves exactly as before, and the public portal is stable if clustering is
  unavailable.

---

# Exit Criteria

Stage 7 is complete only when:

- the embedding-provider boundary, versioned embedding persistence, bounded
  candidate generation, versioned deterministic scoring, the conservative
  assignment engine (idempotent + concurrency-safe), the reviewable provenance
  log, and the audited admin review surface are implemented and tested with
  deterministic fakes (no live API in required CI);
- false-merge risk, source-Article mutation, auto-publishing, lost provenance,
  duplicate StoryArticles, clustering race conditions, and silent reviewed-Story
  changes are all shown absent;
- Stage 3/4/5/5B/6 regressions, the Stage 7 unit + DB integration tests,
  typecheck, lint, format check, the full test suite, and the production build
  all pass, and an admin clustering smoke test with the fake provider succeeds.

---

# HARD STOP

Do not begin Stage 8 (ranking/trending), automated publishing, GitHub ingestion,
or Hacker News ingestion without explicit approval. Do not merge to `main`
without review.
