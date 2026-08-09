import type { Db } from '@/db/client';

import type { AdminAuditLogRow } from '../types';

/** A meaningful admin mutation to be recorded in the audit trail. */
export interface RecordAuditInput {
  /** Stable action verb, e.g. SOURCE_CREATE, SOURCE_DISABLE, ARTICLE_STATUS_CHANGE. */
  action: string;
  /** Human/audit identity of the acting admin (username). */
  actorIdentifier: string;
  /** Optional admin UUID when one exists; env-configured admins have none. */
  actorId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

export interface ListAuditOptions {
  limit?: number;
  targetType?: string;
  targetId?: string;
}

/**
 * Data access for AdminAuditLog — the editorial/administrative change history.
 *
 * Every meaningful admin mutation writes exactly one row here, capturing what
 * changed, which record, relevant before/after state, when, and the acting
 * admin. The table has no foreign keys to its targets, so records persist even
 * after the described object is removed (auditability, CLAUDE.md rule 12/17).
 */
export class AdminAuditLogRepository {
  constructor(private readonly db: Db) {}

  /** Append one audit record. */
  async record(input: RecordAuditInput): Promise<AdminAuditLogRow> {
    const result = await this.db.query<AdminAuditLogRow>(
      `INSERT INTO admin_audit_log
         (actor_id, actor_identifier, action, target_type, target_id,
          before, after, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
       RETURNING *`,
      [
        input.actorId ?? null,
        input.actorIdentifier,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        input.before ? JSON.stringify(input.before) : null,
        input.after ? JSON.stringify(input.after) : null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return result.rows[0] as AdminAuditLogRow;
  }

  /** Most recent audit records, newest first; optionally scoped to one target. */
  async listRecent(
    options: ListAuditOptions = {},
  ): Promise<AdminAuditLogRow[]> {
    const limit = clampLimit(options.limit, 50);
    if (options.targetType && options.targetId) {
      const result = await this.db.query<AdminAuditLogRow>(
        `SELECT * FROM admin_audit_log
         WHERE target_type = $1 AND target_id = $2
         ORDER BY created_at DESC
         LIMIT $3`,
        [options.targetType, options.targetId, limit],
      );
      return result.rows;
    }
    const result = await this.db.query<AdminAuditLogRow>(
      `SELECT * FROM admin_audit_log
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
    );
    return result.rows;
  }
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), 200);
}
