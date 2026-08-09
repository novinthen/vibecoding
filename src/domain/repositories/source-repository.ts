import type { Db } from '@/db/client';

import type { AuthorityTier, SourceType } from '../enums';
import type { SourceRow } from '../types';

export interface CreateSourceInput {
  name: string;
  slug: string;
  sourceType: SourceType;
  authorityTier: AuthorityTier;
  homepageUrl?: string | null;
  feedUrl?: string | null;
  language?: string | null;
  pollInterval?: number | null;
  defaultTopicId?: string | null;
}

/** Data access for Sources (publishers / acquisition endpoints). */
export class SourceRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<SourceRow | null> {
    const result = await this.db.query<SourceRow>(
      'SELECT * FROM sources WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findBySlug(slug: string): Promise<SourceRow | null> {
    const result = await this.db.query<SourceRow>(
      'SELECT * FROM sources WHERE slug = $1',
      [slug],
    );
    return result.rows[0] ?? null;
  }

  /** List enabled sources, most recently created first. */
  async listEnabled(): Promise<SourceRow[]> {
    const result = await this.db.query<SourceRow>(
      'SELECT * FROM sources WHERE enabled = true ORDER BY created_at DESC',
    );
    return result.rows;
  }

  async create(input: CreateSourceInput): Promise<SourceRow> {
    const result = await this.db.query<SourceRow>(
      `INSERT INTO sources
         (name, slug, source_type, authority_tier,
          homepage_url, feed_url, language, poll_interval, default_topic_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.name,
        input.slug,
        input.sourceType,
        input.authorityTier,
        input.homepageUrl ?? null,
        input.feedUrl ?? null,
        input.language ?? null,
        input.pollInterval ?? null,
        input.defaultTopicId ?? null,
      ],
    );
    // RETURNING * on a single-row INSERT always yields exactly one row.
    return result.rows[0] as SourceRow;
  }
}
