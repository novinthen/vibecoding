import type { Db } from '@/db/client';
import {
  AdminAuditLogRepository,
  ArticleRepository,
  SourceFetchRepository,
  SourceRepository,
} from '@/domain';
import { slugify } from '@/domain/slug';
import type { SourceRow } from '@/domain/types';
import { ingestSource, type IngestDeps, type IngestResult } from '@/ingestion';

import { assertCanMutate } from '../auth/guard';
import type { AdminSession } from '../auth/session';
import { AdminValidationError, NotFoundError } from '../errors';
import { createSourceSchema, updateSourceSchema } from '../validation';

import { auditSourceView } from './audit-view';

/**
 * Source management service (Stage 4).
 *
 * Each mutation: (1) enforces authorization server-side, (2) validates untrusted
 * input, (3) writes through the repositories, and (4) records an AdminAuditLog
 * entry — in that order, within the caller's transaction so the mutation and its
 * audit row commit together. Manual ingestion delegates to the Stage 3 engine
 * rather than re-implementing any ingestion logic.
 */

export async function createSource(
  db: Db,
  actor: AdminSession,
  input: unknown,
): Promise<SourceRow> {
  assertCanMutate(actor);
  const values = createSourceSchema.parse(input);
  const slug = values.slug ?? slugify(values.name);
  if (slug.length === 0) {
    throw new AdminValidationError(
      'slug',
      'Could not derive a slug from the name.',
    );
  }

  const sources = new SourceRepository(db);
  const existing = await sources.findBySlug(slug);
  if (existing) {
    throw new AdminValidationError(
      'slug',
      `A Source with slug "${slug}" already exists.`,
    );
  }

  const created = await sources.create({
    name: values.name,
    slug,
    sourceType: values.sourceType,
    authorityTier: values.authorityTier,
    homepageUrl: values.homepageUrl ?? null,
    feedUrl: values.feedUrl ?? null,
    language: values.language ?? null,
    pollInterval: values.pollInterval ?? null,
    defaultTopicId: values.defaultTopicId ?? null,
  });

  await new AdminAuditLogRepository(db).record({
    action: 'SOURCE_CREATE',
    actorIdentifier: actor.username,
    targetType: 'source',
    targetId: created.id,
    after: auditSourceView(created),
    metadata: { role: actor.role },
  });
  return created;
}

export async function updateSource(
  db: Db,
  actor: AdminSession,
  id: string,
  input: unknown,
): Promise<SourceRow> {
  assertCanMutate(actor);
  const values = updateSourceSchema.parse(input);
  const sources = new SourceRepository(db);
  const before = await sources.findById(id);
  if (!before) throw new NotFoundError('Source not found.');

  const updated = await sources.update(id, {
    name: values.name,
    authorityTier: values.authorityTier,
    homepageUrl: values.homepageUrl ?? null,
    feedUrl: values.feedUrl ?? null,
    language: values.language ?? null,
    pollInterval: values.pollInterval ?? null,
    defaultTopicId: values.defaultTopicId ?? null,
  });
  if (!updated) throw new NotFoundError('Source not found.');

  await new AdminAuditLogRepository(db).record({
    action: 'SOURCE_UPDATE',
    actorIdentifier: actor.username,
    targetType: 'source',
    targetId: id,
    before: auditSourceView(before),
    after: auditSourceView(updated),
    metadata: { role: actor.role },
  });
  return updated;
}

export async function setSourceEnabled(
  db: Db,
  actor: AdminSession,
  id: string,
  enabled: boolean,
): Promise<SourceRow> {
  assertCanMutate(actor);
  const sources = new SourceRepository(db);
  const before = await sources.findById(id);
  if (!before) throw new NotFoundError('Source not found.');

  const updated = await sources.setEnabled(id, enabled);
  if (!updated) throw new NotFoundError('Source not found.');

  await new AdminAuditLogRepository(db).record({
    action: enabled ? 'SOURCE_ENABLE' : 'SOURCE_DISABLE',
    actorIdentifier: actor.username,
    targetType: 'source',
    targetId: id,
    before: { enabled: before.enabled, health_status: before.health_status },
    after: { enabled: updated.enabled, health_status: updated.health_status },
    metadata: { role: actor.role },
  });
  return updated;
}

/** Result of a manual ingestion trigger: the ingest outcome plus the Source. */
export interface ManualIngestionResult {
  source: SourceRow;
  result: IngestResult;
}

/**
 * Manually trigger ingestion for one Source through the existing Stage 3
 * engine. This does NOT duplicate ingestion logic — it constructs the same
 * repository-backed dependencies the CLI uses and calls {@link ingestSource},
 * which reuses the Stage 3 safe fetcher (timeouts, redirect bounds, SSRF, size
 * caps) and records a SourceFetch audit row. A separate AdminAuditLog entry
 * records who triggered it and the outcome summary.
 *
 * `ingestOverrides` lets callers/tests inject fetcher/adapter/clock seams; in
 * production nothing is overridden, so the real safe fetcher is used.
 */
export async function triggerSourceIngestion(
  db: Db,
  actor: AdminSession,
  id: string,
  ingestOverrides: Partial<IngestDeps> = {},
): Promise<ManualIngestionResult> {
  assertCanMutate(actor);
  const sources = new SourceRepository(db);
  const source = await sources.findById(id);
  if (!source) throw new NotFoundError('Source not found.');

  const deps: IngestDeps = {
    articles: new ArticleRepository(db),
    sourceFetches: new SourceFetchRepository(db),
    sources,
    ...ingestOverrides,
  };
  const result = await ingestSource(source, deps);

  await new AdminAuditLogRepository(db).record({
    action: 'SOURCE_INGEST_MANUAL',
    actorIdentifier: actor.username,
    targetType: 'source',
    targetId: id,
    metadata: {
      role: actor.role,
      status: result.status,
      httpStatus: result.httpStatus,
      itemsFound: result.itemsFound,
      itemsNew: result.itemsNew,
      itemsExisting: result.itemsExisting,
      itemsSkipped: result.itemsSkipped,
      notModified: result.notModified,
      errorCode: result.errorCode,
    },
  });
  return { source, result };
}
