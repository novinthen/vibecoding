import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import { requireMigrationUrl } from '@/config/env';

/**
 * Minimal, dependency-light forward-only migration runner.
 *
 * Migrations are plain `.sql` files in `src/db/migrations`, applied in
 * lexicographic filename order. Each file runs inside its own transaction and,
 * on success, its version (the filename) is recorded in `schema_migrations`.
 * Re-running is idempotent: already-applied files are skipped. This keeps the
 * schema fully reproducible from source with no external CLI dependency.
 */

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'migrations',
);

export interface Migration {
  version: string;
  sql: string;
}

/** Load and order migration files from disk. */
export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({
      version: name,
      sql: readFileSync(join(dir, name), 'utf8'),
    }));
}

async function ensureMigrationsTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function appliedVersions(client: Client): Promise<Set<string>> {
  const result = await client.query<{ version: string }>(
    'SELECT version FROM schema_migrations',
  );
  return new Set(result.rows.map((row) => row.version));
}

/**
 * Apply all pending migrations. Returns the list of versions applied during
 * this run (empty when the database is already up to date).
 */
export async function migrate(
  connectionString: string = requireMigrationUrl(),
  dir: string = MIGRATIONS_DIR,
): Promise<string[]> {
  const client = new Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await ensureMigrationsTable(client);
    const done = await appliedVersions(client);

    for (const migration of loadMigrations(dir)) {
      if (done.has(migration.version)) continue;

      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          [migration.version],
        );
        await client.query('COMMIT');
        applied.push(migration.version);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(
          `Migration failed: ${migration.version}\n${(error as Error).message}`,
        );
      }
    }
  } finally {
    await client.end();
  }
  return applied;
}

// Allow `tsx src/db/migrate.ts` as a direct entrypoint.
const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  migrate()
    .then((applied) => {
      if (applied.length === 0) {
        console.log('Database already up to date; no migrations applied.');
      } else {
        console.log(`Applied ${applied.length} migration(s):`);
        for (const version of applied) console.log(`  - ${version}`);
      }
    })
    .catch((error: unknown) => {
      console.error((error as Error).message);
      process.exit(1);
    });
}
