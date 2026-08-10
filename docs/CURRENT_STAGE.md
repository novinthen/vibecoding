# Current Stage

# Stage 6 — AI Intelligence

## Status

**ACTIVE**

This file defines the only implementation scope currently approved.

Stage 3 (News Ingestion Engine), Stage 4 (Admin & Editorial Operations), Stage 5
(Public Portal), and Stage 5B (Multi-Publication Localisation) are complete. Do
not begin Stage 7 (Clustering), Stage 8 (Ranking/Trending), GitHub ingestion, or
Hacker News ingestion.

---

# Goal

Add a **safe, versioned AI-enrichment layer** for canonical Articles. AI helps
interpret source facts without becoming the source of truth:

```
Article source facts
  → AI enrichment request (provider-neutral)
  → structured/versioned enrichment record
  → strict machine validation
  → admin review
  → (later, separately approved) controlled promotion into editorial fields
```

AI is **optional and advisory**. If the provider is unavailable, rate-limited,
misconfigured, or returns invalid output: source Articles stay intact, ingestion
and public rendering continue, and the failure is recorded so a retry is safe.

---

# Implemented

1. **Provider-neutral AI boundary** — `src/ai/provider` defines an `AiProvider`
   capability (`completeStructured`) plus a classified error model
   (retryable vs non-retryable). Two implementations: a deterministic
   `FakeProvider` (tests + local smoke, no network) and a thin `AnthropicProvider`
   over `fetch` (no vendor SDK). `src/ai/config.ts` builds a provider from
   validated env config. Domain code depends only on the interface; API keys are
   server-only and never bundled or logged.
2. **Strict structured output** — `src/ai/enrichment/schema.ts` is a `.strict()`
   Zod schema (relevance, relevanceReason, summary, whyItMatters, suggestedTopics,
   suggestedEntities, confidence). Malformed/partial/extra-key replies are
   rejected, never silently accepted. The model may return only
   RELEVANT/MAYBE_RELEVANT/IRRELEVANT; UNCLASSIFIED is system-assigned on failure.
3. **Prompt-injection boundary** — `src/ai/enrichment/prompt.ts` keeps trusted
   task/schema instructions in the `system` field and untrusted Article facts in a
   separate `input` payload wrapped in explicit delimiters. Forged delimiter
   tokens and control characters are stripped from content; secrets are never
   placed in a prompt. Article text is data, never instructions.
4. **Versioned enrichment persistence** — migration `0014` extends the existing
   `article_enrichments` table (no new table) with `enrichment_version`, `status`
   (SUCCEEDED / INVALID_OUTPUT / PROVIDER_ERROR), `relevance`, `schema_version`,
   `suggested_topics/entities`, `usage`, `generated_at`, and error fields, plus a
   `UNIQUE (article_id, enrichment_version)` invariant. Each attempt is an
   immutable new version; re-running preserves prior provenance.
5. **Enrichment service** — `enrichArticle` orchestrates eligibility → prompt →
   provider → strict validation → versioned persistence. It **only** writes to
   `article_enrichments`; it never modifies an Article, Story, Entity, or Topic.
   Provider and validation failures are recorded as their own versions with
   classified error/validation detail.
6. **Read-only suggestion matching** — `resolveSuggestions` deterministically maps
   suggested Topics/Entities to existing canonical records (by slug / normalised
   alias) and splits them into `matched` vs `unresolved`. It creates nothing: a
   hallucinated name can never silently become a canonical Topic, Entity, or alias.
7. **Admin trigger + review** — the Article detail page shows the latest
   enrichment, prior versions, relevance, summary, why-it-matters,
   provider/model/version, confidence, suggestions (matched vs candidate), and
   validation/provider errors. An authorized **manual** trigger (mutating admins
   only; VIEWERs refused) runs one bounded enrichment and writes an
   `ARTICLE_ENRICHMENT_TRIGGER` audit row. Nothing is published by the trigger.
8. **Cost/control seams** — eligibility gate, explicit manual trigger, bounded
   content/token limits, provider/model selection via env, token/cost metadata,
   and retryable-error classification. No production scheduling was added.

See [`docs/ARCHITECTURE.MD`](ARCHITECTURE.MD) (AI Architecture) and
[`docs/ADMIN.md`](ADMIN.md) for operational detail.

---

# Do Not Implement

- Story clustering / semantic clustering; ranking/trending; embeddings
  generation;
- automated publishing; automated Story creation; **automatic promotion of AI
  output into canonical Story/editorial fields**;
- GitHub ingestion; Hacker News ingestion; automated translation/localisation;
- recommendation systems; user personalization; autonomous editorial decisions;
- new queueing/search/database infrastructure; production enrichment scheduling.

---

# Important Invariants

- AI output is **advisory**. A RELEVANT classification never publishes an Article;
  promotion into canonical/editorial fields is a separate, explicit, approved
  workflow that Stage 6 does not perform.
- AI **never** overwrites Article/Story source facts. Enrichment lives only in the
  separate, versioned `article_enrichments` table.
- Every enrichment attempt is machine-validated before persistence; a malformed
  reply is recorded as INVALID_OUTPUT, not trusted.
- Re-running enrichment **versions** derived data; it never destroys prior
  provenance.
- Suggested Topics/Entities are candidates until an explicit review/matching layer
  resolves them; no canonical record is created silently.
- AI is optional: with no provider configured, ingestion, admin, and public
  rendering behave exactly as before.
- Article/feed content is untrusted and is passed to the model strictly as data.

---

# Exit Criteria

Stage 6 is complete only when:

- the provider abstraction, strict schema validation, prompt-injection boundary,
  versioned persistence, relevance classification, suggestion-matching, and the
  audited admin trigger/review are implemented and tested with deterministic
  fakes (no live AI in required CI);
- AI overwriting source facts, auto-publishing AI output, lost provenance, weak
  validation, prompt-injection exposure, secret leakage, uncontrolled execution,
  and silent Entity/Topic creation are all shown absent;
- Stage 3/4/5/5B regressions, the Stage 6 unit + DB integration tests, typecheck,
  lint, format check, the full test suite, and the production build all pass, and
  an admin enrichment smoke test with a fake provider succeeds.

---

# HARD STOP

Do not begin Stage 7 (clustering), Stage 8 (ranking/trending), automated
publishing, GitHub ingestion, or Hacker News ingestion without explicit approval.
Do not merge to `main` without review.
