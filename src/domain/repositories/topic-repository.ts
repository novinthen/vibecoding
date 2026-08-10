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

  async findById(id: string): Promise<TopicRow | null> {
    const result = await this.db.query<TopicRow>(
      'SELECT * FROM topics WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listTopLevel(): Promise<TopicRow[]> {
    const result = await this.db.query<TopicRow>(
      'SELECT * FROM topics WHERE parent_id IS NULL ORDER BY name',
    );
    return result.rows;
  }

  /** List every Topic (admin view), parents before their children, by name. */
  async listAll(): Promise<TopicRow[]> {
    const result = await this.db.query<TopicRow>(
      `SELECT * FROM topics
       ORDER BY (parent_id IS NOT NULL), name`,
    );
    return result.rows;
  }

  /**
   * Create a Topic. Stage 4 permits controlled sub-Topics under an existing
   * top-level parent; the top-level taxonomy itself remains fixed by seed data
   * and is not extended here (CLAUDE.md: do not modify the controlled top-level
   * taxonomy). `parentId` is required to enforce that.
   */
  async create(input: {
    name: string;
    slug: string;
    description?: string | null;
    parentId: string;
  }): Promise<TopicRow> {
    const result = await this.db.query<TopicRow>(
      `INSERT INTO topics (name, slug, description, parent_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.name, input.slug, input.description ?? null, input.parentId],
    );
    return result.rows[0] as TopicRow;
  }

  /** Edit a Topic's descriptive fields (not its slug or parent). */
  async update(
    id: string,
    input: { name: string; description: string | null },
  ): Promise<TopicRow | null> {
    const result = await this.db.query<TopicRow>(
      `UPDATE topics SET name = $2, description = $3 WHERE id = $1 RETURNING *`,
      [id, input.name, input.description],
    );
    return result.rows[0] ?? null;
  }

  /** Enable or disable a Topic. */
  async setEnabled(id: string, enabled: boolean): Promise<TopicRow | null> {
    const result = await this.db.query<TopicRow>(
      `UPDATE topics SET enabled = $2 WHERE id = $1 RETURNING *`,
      [id, enabled],
    );
    return result.rows[0] ?? null;
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
