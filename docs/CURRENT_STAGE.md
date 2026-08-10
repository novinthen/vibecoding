# Current Stage

# Stage 4 — Admin & Editorial Operations

## Status

**ACTIVE**

This file defines the only implementation scope currently approved.

Stage 3 (News Ingestion Engine) is complete and merged. Do not begin Stage 5
(Public Portal) or any later stage (AI, Clustering, Ranking, GitHub or Hacker
News ingestion, multi-publication rendering).

---

# Goal

Build the minimum secure admin/editorial control plane needed to operate and
inspect the ingestion system. The admin makes the existing ingestion system
observable and controllable. Operational usefulness is prioritized over visual
polish.

The admin surface lives inside the same Next.js application (`/admin`) — a
modular monolith, not a separate service.

---

# Implemented

1. **Admin authentication/authorization** — env-configured roster
   (`ADMIN_USERS`, scrypt hashes), stateless HMAC-signed httpOnly session
   cookie (`ADMIN_SESSION_SECRET`), and a role model (`ADMIN`/`EDITOR`/`VIEWER`).
   Authorization is enforced server-side in every mutation, not in the UI.
2. **Source management** — list, inspect, create, edit permitted fields,
   enable/disable, health / consecutive failures / last success /
   conditional-fetch state, and manual ingestion delegated to the Stage 3
   engine (no duplicated ingestion logic).
3. **Fetch operations** — global `SourceFetch` inspection with status filtering,
   HTTP/result info, counts, and error details; failed/degraded Sources are easy
   to identify.
4. **Article inspection** — list with Source/status/text filters and date-ordered
   pagination; detail view of canonical/source URLs, source facts, timestamps,
   and hashes. Article status change is the only Article mutation. Article ≠
   Story is preserved.
5. **Editorial operations** — Article status changes, Source authority/default-
   topic management, and controlled sub-Topic management + enable/disable.
6. **Admin auditability** — every meaningful mutation writes an `AdminAuditLog`
   record (action, target, before/after where practical, timestamp, acting
   admin) via the existing audit architecture.

See `docs/ADMIN.md` for the auth model, environment requirements, and security
notes.

---

# Do Not Implement

- AI summarization, Entity extraction, embeddings, Story clustering,
  ranking/trending;
- GitHub ingestion; Hacker News ingestion;
- translation/localisation workflows; multi-publication public rendering; the
  public portal;
- recommendation systems; analytics dashboards beyond basic operational metrics;
- production scheduling; new queueing/search/database infrastructure.

---

# Important Invariants

- Article ≠ Story; the admin never turns Article inspection into Story editing.
- Source facts remain untouched by admin edits (only status/operational and
  permitted config fields change); provenance preserved.
- The `/admin` surface is not publicly writable; server-side authorization
  protects every mutation.
- Manual ingestion reuses the Stage 3 SSRF/fetch protections; no ingestion logic
  is duplicated.
- Feed-derived Article/Source content is untrusted and never rendered as unsafe
  HTML.
- No secrets, raw credentials, or internal stack traces are exposed.

---

# Exit Criteria

Stage 4 is complete only when:

- the `/admin` surface is authenticated and server-side authorization protects
  all mutations (unauthorized mutations are rejected);
- Sources can be listed, inspected, created, edited, enabled/disabled, and
  manually ingested through the existing engine;
- `SourceFetch` history and Article inspection/filtering work against the
  existing schema;
- every meaningful admin mutation produces an `AdminAuditLog` record;
- untrusted feed content renders safely;
- tests (auth/authz, unauthorized-mutation rejection, source create/edit/enable,
  validation failures, audit-log creation, manual-ingestion delegation,
  query/filter behavior, safe rendering), DB integration tests, the Stage 3
  ingestion regression tests, typecheck, lint, format check, the full test
  suite, and the production build all pass.

---

# HARD STOP

Do not begin Stage 5 or later, AI, clustering, ranking, GitHub ingestion, or
Hacker News ingestion without explicit approval. Do not merge to `main` without
review.
