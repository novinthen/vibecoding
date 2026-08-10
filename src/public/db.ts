import { appEnv } from '@/config/env';
import { getPool, type Db } from '@/db/client';

/**
 * Database access for the public portal.
 *
 * PostgreSQL is the authoritative source of truth and public rendering reads
 * from it directly (it never depends on live AI calls — CLAUDE.md rule 7). These
 * helpers mirror the admin `_lib/db` seam: pages check `isDatabaseConfigured()`
 * and render an honest "unavailable" state when no database is configured, so
 * builds and previews without a database never crash.
 */
export function isDatabaseConfigured(): boolean {
  return Boolean(appEnv.DATABASE_URL);
}

/** The shared connection pool as a `Db`. Throws if no database is configured. */
export function getDb(): Db {
  return getPool();
}
