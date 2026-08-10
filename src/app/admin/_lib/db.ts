import { appEnv } from '@/config/env';
import { getPool, type Db } from '@/db/client';

/** Whether a database connection is configured for this deployment. */
export function isDatabaseConfigured(): boolean {
  return Boolean(appEnv.DATABASE_URL);
}

/** The shared connection pool as a Db. Throws if no database is configured. */
export function getDb(): Db {
  return getPool();
}
