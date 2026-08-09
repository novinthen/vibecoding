import type { Db } from '@/db/client';

import type { SourceFetchStatus } from '../enums';
import type { SourceFetchRow } from '../types';

/** Terminal outcome recorded when a fetch attempt completes. */
export interface CompleteFetchInput {
  status: SourceFetchStatus;
  httpStatus?: number | null;
  itemsFound?: number | null;
  itemsNew?: number | null;
  itemsUpdated?: number | null;
  durationMs?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Data access for SourceFetch — the operational audit log of every fetch
 * attempt. A row is opened (STARTED) before work begins and closed with its
 * terminal status, so failures remain observable even when the fetch throws
 * (a broken Source must never silently disappear).
 */
export class SourceFetchRepository {
  constructor(private readonly db: Db) {}

  /** Open an audit row for a new fetch attempt. */
  async start(sourceId: string): Promise<SourceFetchRow> {
    const result = await this.db.query<SourceFetchRow>(
      `INSERT INTO source_fetches (source_id, status)
       VALUES ($1, 'STARTED')
       RETURNING *`,
      [sourceId],
    );
    return result.rows[0] as SourceFetchRow;
  }

  /** Close an audit row with its terminal outcome. */
  async complete(id: string, input: CompleteFetchInput): Promise<void> {
    await this.db.query(
      `UPDATE source_fetches SET
         completed_at  = now(),
         status        = $2,
         http_status   = $3,
         items_found   = $4,
         items_new     = $5,
         items_updated = $6,
         duration_ms   = $7,
         error_code    = $8,
         error_message = $9,
         metadata      = $10::jsonb
       WHERE id = $1`,
      [
        id,
        input.status,
        input.httpStatus ?? null,
        input.itemsFound ?? null,
        input.itemsNew ?? null,
        input.itemsUpdated ?? null,
        input.durationMs ?? null,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  /** Most recent fetch rows for a Source, newest first. */
  async listRecent(sourceId: string, limit = 20): Promise<SourceFetchRow[]> {
    const result = await this.db.query<SourceFetchRow>(
      `SELECT * FROM source_fetches
       WHERE source_id = $1
       ORDER BY started_at DESC
       LIMIT $2`,
      [sourceId, limit],
    );
    return result.rows;
  }
}
