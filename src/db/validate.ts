import { fileURLToPath } from 'node:url';

import { closePool, getPool, type Db } from './client';

/**
 * Database/environment validation.
 *
 * Confirms the configured database is reachable and that every canonical table
 * from the migrations exists. Intended as a fast fail-loud check for CI and
 * local setup (`npm run db:validate`). It does not mutate data.
 */
export const EXPECTED_TABLES = [
  'schema_migrations',
  'topics',
  'publications',
  'publication_domains',
  'sources',
  'source_fetches',
  'articles',
  'entities',
  'entity_aliases',
  'article_entities',
  'stories',
  'story_articles',
  'story_entities',
  'article_enrichments',
  'publication_stories',
  'story_localizations',
  'article_embeddings',
  'story_embeddings',
  'clustering_decisions',
  'admin_audit_log',
] as const;

export interface ValidationResult {
  ok: boolean;
  missing: string[];
}

export async function validateSchema(db: Db): Promise<ValidationResult> {
  const result = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'`,
  );
  const present = new Set(result.rows.map((row) => row.table_name));
  const missing = EXPECTED_TABLES.filter((table) => !present.has(table));
  return { ok: missing.length === 0, missing };
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  getPool()
    .query('SELECT 1')
    .then(async () => {
      const result = await validateSchema(getPool());
      if (result.ok) {
        console.log(
          `Database OK. All ${EXPECTED_TABLES.length} expected tables present.`,
        );
      } else {
        console.error('Database schema incomplete. Missing tables:');
        for (const table of result.missing) console.error(`  - ${table}`);
      }
      await closePool();
      if (!result.ok) process.exit(1);
    })
    .catch(async (error: unknown) => {
      console.error(`Database validation failed: ${(error as Error).message}`);
      await closePool();
      process.exit(1);
    });
}
