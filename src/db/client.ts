import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from 'pg';

import { requireDatabaseUrl } from '@/config/env';

/**
 * PostgreSQL access for the modular monolith.
 *
 * A single lazily-initialised connection pool is shared across the process.
 * Domain code should depend on the small `Db` interface below rather than
 * importing `pg` directly, keeping database access behind a clear boundary
 * (CLAUDE.md rule 8) and making repositories trivially testable against either
 * the real pool or a transaction-scoped client.
 */

/** Minimal query surface shared by the pool and a transaction client. */
export interface Db {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

let pool: Pool | undefined;

/** Build a pool config from the environment. Exported for tests. */
export function buildPoolConfig(connectionString: string): PoolConfig {
  return {
    connectionString,
    // Supabase requires TLS; `pg` verifies against the system CA by default.
    // The connection string may also carry `?sslmode=require`.
    max: 10,
    // Fail fast rather than hanging if the database is unreachable.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  };
}

/**
 * Return the shared connection pool, creating it on first use. Throws a clear
 * error (via requireDatabaseUrl) when no database is configured.
 */
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(buildPoolConfig(requireDatabaseUrl()));
  }
  return pool;
}

/** Close the shared pool (used by scripts and test teardown). */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

/**
 * Run `fn` inside a single transaction, committing on success and rolling back
 * on any error. Workers and multi-statement operations should use this so that
 * partial writes never leak (keeps future workers idempotent).
 */
export async function withTransaction<T>(
  fn: (tx: Db) => Promise<T>,
  poolInstance: Pool = getPool(),
): Promise<T> {
  const client: PoolClient = await poolInstance.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
