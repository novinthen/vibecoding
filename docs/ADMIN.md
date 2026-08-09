# Admin & Editorial Operations (Stage 4)

The admin surface is the secure control plane for operating and inspecting the
ingestion system. It lives inside the same Next.js application under `/admin`
(modular monolith — no separate service).

## What it does

- **Overview** (`/admin`): source health counts, recent failures, recent
  fetches, recently ingested Articles, and the Sources that need attention.
- **Sources** (`/admin/sources`): list, inspect, create, edit permitted fields,
  enable/disable, inspect health / consecutive failures / last success /
  conditional-fetch (ETag / Last-Modified) state, and **manually trigger
  ingestion** for one Source through the existing Stage 3 engine.
- **Fetches** (`/admin/fetches`): recent `SourceFetch` attempts across all
  Sources with status filtering, HTTP/result info, counts, and error codes.
- **Articles** (`/admin/articles`): search/filter by Source, status, and
  title/excerpt text with date-ordered pagination; a detail view exposes
  canonical/source URLs, source facts, timestamps, and hashes/identifiers. The
  only Article mutation is a **lifecycle status change** — Article inspection is
  never Story editing, and source facts are read-only (provenance preserved).
- **Topics** (`/admin/topics`): view the controlled taxonomy, add a sub-Topic
  under an existing top-level Topic, and enable/disable Topics. The fixed
  top-level taxonomy is not extended here.

Every meaningful mutation writes an `AdminAuditLog` record (what changed, which
record, before/after where practical, timestamp, and the acting admin).

## Authentication & authorization

Stage 4 uses the **smallest production-sensible** boundary compatible with the
architecture — no heavyweight auth framework, no new database tables, no new
runtime dependencies:

- **Credentials** live in the environment, not the database. `ADMIN_USERS` is a
  JSON array of `{ username, passwordHash, role? }`. Passwords are stored **only
  as scrypt hashes** (Node `crypto`, no third-party lib). Generate a hash with:

  ```bash
  npm run admin:hash -- 'your-password'
  ```

- **Sessions** are stateless, HMAC-SHA256-signed tokens (signed with
  `ADMIN_SESSION_SECRET`) transported as an **httpOnly, SameSite=Lax** cookie.
  There is no session store (no Redis, no table). Tokens expire after 12 hours.

- **Roles**: `ADMIN`, `EDITOR`, `VIEWER`. `ADMIN`/`EDITOR` may perform the
  implemented mutations; `VIEWER` is read-only. Authorization is enforced
  **server-side** in every admin service before any write — hiding a button is
  never the control. Unauthenticated requests are redirected to `/admin/login`;
  authenticated-but-forbidden (VIEWER) mutations are rejected.

- **CSRF**: mutations use Next.js Server Actions (POST with framework origin
  checks) and a SameSite=Lax cookie, so cross-site POSTs do not carry the
  session.

- **Manual ingestion** reuses the Stage 3 safe fetcher unchanged (timeout,
  bounded redirects with per-hop SSRF revalidation, response-size cap). No
  ingestion logic is duplicated in the admin layer.

### Required environment

| Variable                | Required for admin | Notes                                              |
| ----------------------- | ------------------ | -------------------------------------------------- |
| `ADMIN_SESSION_SECRET`  | Yes                | Cookie signing secret. ≥ 32 chars in production.   |
| `ADMIN_USERS`           | Yes                | JSON roster of `{ username, passwordHash, role? }`.|
| `DATABASE_URL`          | Yes                | The admin reads/writes Postgres.                   |

Example `ADMIN_USERS` (never commit real values):

```json
[{ "username": "alice", "passwordHash": "scrypt:16384:8:1:<salt>:<hash>", "role": "ADMIN" }]
```

If the admin variables are unset the app still builds and boots; `/admin/login`
shows a "not configured" notice and no session can be issued.

## Security notes

- All feed-derived Article/Source content is treated as untrusted. The UI never
  uses `dangerouslySetInnerHTML`; untrusted text is escaped by React and
  feed-derived URLs are rendered as links only when they are http(s)
  (`src/admin/safe-url.ts`).
- Admin mutation input is validated server-side with Zod (`src/admin/validation.ts`).
- No secrets, raw credentials, or internal stack traces are exposed to the
  browser; unexpected errors are logged server-side and surfaced generically.
