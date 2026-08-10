import type { Db } from '@/db/client';

import type { AuthorityTier, HealthStatus, SourceType } from '../enums';
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

/**
 * State written back to a Source after a fetch attempt: the derived health, the
 * fetch timestamps, and the conditional-request validators from the response.
 * `undefined` fields are left unchanged; `null` clears a column.
 */
export interface UpdateFetchStateInput {
  failureCount: number;
  healthStatus: HealthStatus;
  lastFetchAt: Date | string;
  lastSuccessAt?: Date | string | null;
  etag?: string | null;
  lastModified?: string | null;
}

/**
 * Fields an admin may edit on an existing Source. `slug` and `source_type` are
 * deliberately excluded: the slug is stable identity, and the type selects the
 * ingestion adapter contract. The full editable set is passed at once (the admin
 * service loads the row, applies form changes, then writes), avoiding dynamic
 * SQL. `null` clears an optional column.
 */
export interface UpdateSourceInput {
  name: string;
  authorityTier: AuthorityTier;
  homepageUrl: string | null;
  feedUrl: string | null;
  language: string | null;
  pollInterval: number | null;
  defaultTopicId: string | null;
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

  /** List every Source (admin view), most recently created first. */
  async listAll(): Promise<SourceRow[]> {
    const result = await this.db.query<SourceRow>(
      'SELECT * FROM sources ORDER BY created_at DESC',
    );
    return result.rows;
  }

  /** Count Sources grouped by health status (overview metrics). */
  async countByHealth(): Promise<Record<HealthStatus, number>> {
    const result = await this.db.query<{
      health_status: HealthStatus;
      count: string;
    }>(
      'SELECT health_status, COUNT(*)::text AS count FROM sources GROUP BY health_status',
    );
    const counts: Record<HealthStatus, number> = {
      HEALTHY: 0,
      DEGRADED: 0,
      FAILING: 0,
      DISABLED: 0,
      UNKNOWN: 0,
    };
    for (const row of result.rows) {
      counts[row.health_status] = Number(row.count);
    }
    return counts;
  }

  /** Apply an admin edit to the permitted Source fields. */
  async update(
    id: string,
    input: UpdateSourceInput,
  ): Promise<SourceRow | null> {
    const result = await this.db.query<SourceRow>(
      `UPDATE sources SET
         name           = $2,
         authority_tier = $3,
         homepage_url   = $4,
         feed_url       = $5,
         language       = $6,
         poll_interval  = $7,
         default_topic_id = $8
       WHERE id = $1
       RETURNING *`,
      [
        id,
        input.name,
        input.authorityTier,
        input.homepageUrl,
        input.feedUrl,
        input.language,
        input.pollInterval,
        input.defaultTopicId,
      ],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Enable or disable a Source. Disabling also sets health to DISABLED so the
   * operational view reflects the intent; enabling returns health to UNKNOWN so
   * the next fetch re-derives it (ingestion never auto-DISABLEs, so this manual
   * transition is the only writer of the DISABLED state).
   */
  async setEnabled(id: string, enabled: boolean): Promise<SourceRow | null> {
    const result = await this.db.query<SourceRow>(
      `UPDATE sources SET
         enabled = $2,
         health_status = CASE
           WHEN $2 = false THEN 'DISABLED'
           WHEN health_status = 'DISABLED' THEN 'UNKNOWN'
           ELSE health_status
         END
       WHERE id = $1
       RETURNING *`,
      [id, enabled],
    );
    return result.rows[0] ?? null;
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

  /**
   * Idempotently upsert a registry Source by slug. Source-supplied registry
   * fields are refreshed; operational state (health, counters, validators) is
   * left untouched so re-registering never resets a Source's history.
   */
  async upsertBySlug(input: CreateSourceInput): Promise<SourceRow> {
    const result = await this.db.query<SourceRow>(
      `INSERT INTO sources
         (name, slug, source_type, authority_tier,
          homepage_url, feed_url, language, poll_interval, default_topic_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (slug) DO UPDATE SET
         name           = EXCLUDED.name,
         source_type    = EXCLUDED.source_type,
         authority_tier = EXCLUDED.authority_tier,
         homepage_url   = EXCLUDED.homepage_url,
         feed_url       = EXCLUDED.feed_url,
         language       = EXCLUDED.language,
         poll_interval  = EXCLUDED.poll_interval
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
    return result.rows[0] as SourceRow;
  }

  /**
   * Persist the outcome of a fetch attempt: derived health, failure counter,
   * fetch timestamps, and the conditional-request validators. `lastSuccessAt`,
   * `etag`, and `lastModified` are only written when provided (COALESCE keeps
   * the existing value when the argument is undefined → passed as NULL sentinel).
   */
  async updateFetchState(
    id: string,
    input: UpdateFetchStateInput,
  ): Promise<void> {
    await this.db.query(
      `UPDATE sources SET
         failure_count   = $2,
         health_status   = $3,
         last_fetch_at   = $4,
         last_success_at = CASE WHEN $5::boolean THEN $6 ELSE last_success_at END,
         etag            = CASE WHEN $7::boolean THEN $8 ELSE etag END,
         last_modified   = CASE WHEN $9::boolean THEN $10 ELSE last_modified END
       WHERE id = $1`,
      [
        id,
        input.failureCount,
        input.healthStatus,
        toTimestamp(input.lastFetchAt),
        input.lastSuccessAt !== undefined,
        input.lastSuccessAt !== undefined
          ? toTimestamp(input.lastSuccessAt)
          : null,
        input.etag !== undefined,
        input.etag ?? null,
        input.lastModified !== undefined,
        input.lastModified ?? null,
      ],
    );
  }
}

function toTimestamp(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}
