import type { Db } from '@/db/client';

import type { TopicSeed } from '../topics';
import type { TopicRow } from '../types';

/**
 * Data access for the controlled Topic taxonomy.
 *
 * Repositories are deliberately thin wrappers over parameterized SQL — the
 * data-access boundary (CLAUDE.md rule 8) without an enterprise framework.
 */
export class TopicRepository {
  constructor(private readonly db: Db) {}

  async findBySlug(slug: string): Promise<TopicRow | null> {
    const result = await this.db.query<TopicRow>(
      'SELECT * FROM topics WHERE slug = $1',
      [slug],
    );
    return result.rows[0] ?? null;
  }

  async listTopLevel(): Promise<TopicRow[]> {
    const result = await this.db.query<TopicRow>(
      'SELECT * FROM topics WHERE parent_id IS NULL ORDER BY name',
    );
    return result.rows;
  }

  /**
   * Idempotently insert the controlled top-level Topics. Existing slugs are left
   * untouched (name is not overwritten, preserving any editorial rename). Used by
   * the seed workflow. Returns the number of rows newly inserted.
   */
  async seedTopLevel(seeds: readonly TopicSeed[]): Promise<number> {
    let inserted = 0;
    for (const seed of seeds) {
      const result = await this.db.query(
        `INSERT INTO topics (name, slug, parent_id)
         VALUES ($1, $2, NULL)
         ON CONFLICT (slug) DO NOTHING`,
        [seed.name, seed.slug],
      );
      inserted += result.rowCount ?? 0;
    }
    return inserted;
  }
}
