import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadMigrations } from '@/db/migrate';
import { EXPECTED_TABLES } from '@/db/validate';

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../src/db/migrations',
);

const allSql = (): string =>
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n');

describe('migration files', () => {
  it('load in stable lexicographic order with unique versions', () => {
    const migrations = loadMigrations(MIGRATIONS_DIR);
    const versions = migrations.map((m) => m.version);
    expect(versions.length).toBeGreaterThan(0);
    expect([...versions]).toEqual([...versions].sort());
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('create every table the validator expects (except the runner table)', () => {
    const sql = allSql();
    for (const table of EXPECTED_TABLES) {
      if (table === 'schema_migrations') continue; // created by the runner
      expect(sql).toContain(`CREATE TABLE ${table} (`);
    }
  });

  it('protects canonical Articles from source deletion (RESTRICT, not CASCADE)', () => {
    const sql = allSql();
    expect(sql).toMatch(
      /source_id\s+uuid NOT NULL REFERENCES sources \(id\) ON DELETE RESTRICT/,
    );
  });

  it('never overwrites source facts: enrichment is a separate table', () => {
    const sql = allSql();
    expect(sql).toContain('CREATE TABLE article_enrichments (');
    expect(sql).toContain('CREATE TABLE article_embeddings (');
  });

  it('keeps the audit log free of foreign keys so it survives target deletion', () => {
    const auditSql = readFileSync(
      join(MIGRATIONS_DIR, '0011_audit.sql'),
      'utf8',
    );
    expect(auditSql).toContain('CREATE TABLE admin_audit_log (');
    expect(auditSql).not.toContain('REFERENCES');
  });

  it('prevents duplicate Story–Article and Publication–Story relationships', () => {
    const sql = allSql();
    expect(sql).toContain('PRIMARY KEY (story_id, article_id)');
    expect(sql).toContain('UNIQUE (publication_id, story_id)');
  });

  it('nests StoryLocalization under PublicationStory (one locale per parent)', () => {
    const sql = allSql();
    // Localisation belongs to a PublicationStory, not to a bare (pub, story) pair.
    expect(sql).toMatch(
      /publication_story_id\s+uuid NOT NULL\s+REFERENCES publication_stories \(id\) ON DELETE CASCADE/,
    );
    expect(sql).toContain('UNIQUE (publication_story_id, locale)');
    // The old independent shape must be gone.
    expect(sql).not.toContain('UNIQUE (publication_id, story_id, locale)');
  });

  it('uses partial unique indexes for nullable duplicate-prevention keys', () => {
    const sql = allSql();
    expect(sql).toMatch(
      /articles_source_url_hash_key[\s\S]*?WHERE url_hash IS NOT NULL/,
    );
  });
});
