# Current Stage

# Stage 5B — Multi-Publication Localisation

## Status

**ACTIVE**

This file defines the only implementation scope currently approved.

Stage 3 (News Ingestion Engine), Stage 4 (Admin & Editorial Operations), and
Stage 5 (Public Portal) are complete and merged. Do not begin Stage 6 (AI),
Stage 7 (Clustering), Stage 8 (Ranking/Trending), GitHub ingestion, or Hacker
News ingestion.

---

# Goal

Make the public portal genuinely multi-publication and localisation-ready:

```
one canonical intelligence backend
  → multiple Publications
  → multiple domains
  → multiple locales
  → publication-specific editorial presentation
```

Canonical Article/Story facts are **global** and are never duplicated. Each
Publication is an independent editorial brand with its own domain(s), name,
locale, positioning, Story selection, headline, summary, slug, publication
state, and SEO identity. Localisation content for one Publication never leaks
into another.

The work builds on the existing schema (migrations `0003`, `0009`) — Publication,
PublicationDomain, PublicationStory, StoryLocalization already exist — so
**Stage 5B required no schema migrations**.

---

# Implemented

1. **Publication administration** — an authorized, audited admin surface
   (`/admin/publications`) to list, create, edit, and activate/deactivate
   Publications; manage primary/default locale, timezone, branding (name,
   tagline), SEO description, and editorial profile (positioning, audience);
   and add/remove/enable/disable domains, mark one primary domain per
   Publication, and enforce global domain uniqueness. Branding/SEO/editorial
   JSONB edits **merge** (unknown keys preserved; AI/source facts never
   overwritten).
2. **PublicationStory workflow** — attach a **real** canonical Story to a
   Publication and edit its per-Publication presentation (slug, headline,
   published summary, published "why it matters", featured, editorial priority,
   status). Publishing stamps `published_at` once and requires a slug. Canonical
   Story facts are never altered. The same Story may be published by many
   Publications with different headlines. No fake Stories are created.
3. **StoryLocalization workflow** — multiple locale rows per PublicationStory
   (one per `(publication_story, locale)`), each with localized headline,
   summary, why-it-matters, localisation status (DRAFT/REVIEW/PUBLISHED/
   ARCHIVED), translation source/provenance, model provider/name, and
   reviewer. Languages are **rows keyed by locale**, never columns. Stage 5B
   supports **manual/editorial localisation and import of translated text** — no
   automated AI translation provider is invoked (that is a Stage 6 seam).
4. **Public locale resolution** — deterministic and publication-controlled:
   the domain determines the Publication; the locale is a valid `?locale=`
   parameter else the Publication's `default_locale`. Browser
   `Accept-Language` is never consulted. Locales are validated against a
   conservative BCP-47 subset.
5. **Locale-aware Story rendering** — for a resolved Publication the Story route
   loads the PUBLISHED PublicationStory, then applies an **approved
   (PUBLISHED)** StoryLocalization for the chosen locale, else the
   default-locale localisation, else the Publication's own canonical publication
   copy. Every localisation read is scoped to that PublicationStory, so content
   can never be borrowed from another Publication. Article pages remain based on
   canonical Article/source facts and are never auto-translated.
6. **SEO/localised metadata** — publication-specific canonical URLs built from
   the validated domain; localized title/description; Open Graph locale reflects
   the rendered locale; hreflang alternates cover a Story's approved locales
   **within the same Publication origin** (never cross-domain); the root
   `<html lang>` reflects the active Publication's default locale; the sitemap
   lists real published Stories.
7. **Publication-aware feed** — `/feed.xml` is an Atom feed scoped to the
   resolved Publication: its domain, PUBLISHED Story selection, editorial copy,
   default-locale metadata, and Publication attribution. It fails closed on an
   unresolved production host and yields an honest empty feed when there are no
   published Stories.
8. **Auditability** — every Publication/domain/PublicationStory/StoryLocalization
   mutation writes an `AdminAuditLog` row (actor, action, target, before/after,
   metadata) inside the same transaction as the mutation.

See [`docs/PUBLIC_PORTAL.md`](PUBLIC_PORTAL.md) for the localisation architecture
and resolution/fallback rules.

---

# Do Not Implement

- AI summaries; automated AI translation; Entity extraction; embeddings; Story
  clustering; ranking/trending;
- GitHub ingestion; Hacker News ingestion; arbitrary scraping;
- user accounts; personalization; comments; recommendation ML; payments; native
  apps;
- new queueing/search/database infrastructure.

Do not create fake Story data to demonstrate localisation.

---

# Important Invariants

- Canonical Articles and Stories are global; Publication-specific presentation
  and localisation never overwrite canonical facts.
- One Story may be published by many Publications; one PublicationStory may have
  many locales; one locale may appear across many Publications; the same Story
  may have different English headlines across different English Publications.
- Localisation content from Publication A must never leak into Publication B.
- Only PUBLISHED public content is rendered publicly (PublicationStory PUBLISHED;
  StoryLocalization PUBLISHED).
- Production domains continue to **fail closed** unless configured.
- Locale selection is deterministic and publication-controlled; no browser
  header silently changes the Publication or served locale.
- No canonical domain logic assumes a single hostname, brand, or locale.

---

# Exit Criteria

Stage 5B is complete only when:

- Publication/domain/PublicationStory/StoryLocalization admin is server-authorized
  and audited; domain uniqueness and the one-primary-domain invariant hold;
- PublicationStory presentation is separate from canonical Story facts, and
  StoryLocalization parentage / one-locale-per-PublicationStory / multi-locale
  behave correctly, with no cross-Publication leakage;
- public locale resolution and the documented fallback render correctly, and
  publication-specific canonical/metadata is generated without cross-domain
  canonicalisation;
- the production fail-closed behaviour is preserved;
- Stage 3/4/5 regressions, the Stage 5B localisation tests, typecheck, lint,
  format check, the full test suite, and the production build all pass, and at
  least two configured Publications with different domains/locales smoke-test
  correctly.

---

# HARD STOP

Do not begin Stage 6, Stage 7, ranking, GitHub ingestion, or Hacker News
ingestion without explicit approval. Do not merge to `main` without review.
