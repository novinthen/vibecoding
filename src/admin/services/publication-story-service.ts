import type { Db } from '@/db/client';
import {
  AdminAuditLogRepository,
  PublicationRepository,
  PublicationStoryRepository,
  StoryRepository,
} from '@/domain';
import type { PublicationStoryStatus } from '@/domain/enums';
import type { PublicationStoryRow } from '@/domain/types';

import { assertCanMutate } from '../auth/guard';
import type { AdminSession } from '../auth/session';
import { AdminValidationError, NotFoundError } from '../errors';
import {
  createPublicationStorySchema,
  setPublicationStoryStatusSchema,
  updatePublicationStorySchema,
} from '../validation';

import { auditPublicationStoryView } from './audit-view';

/**
 * PublicationStory editorial workflow (Stage 5B).
 *
 * Attaches a REAL canonical Story to a Publication and edits its
 * publication-specific presentation (slug/headline/summary/why-it-matters/
 * featured/priority/status). It NEVER alters canonical Story facts — those live
 * on the `stories` row and are read only to validate the link exists. The same
 * canonical Story may be attached by many Publications, each with its own
 * editorial projection.
 */

export async function createPublicationStory(
  db: Db,
  actor: AdminSession,
  publicationId: string,
  input: unknown,
): Promise<PublicationStoryRow> {
  assertCanMutate(actor);
  const values = createPublicationStorySchema.parse(input);

  const publication = await new PublicationRepository(db).findById(
    publicationId,
  );
  if (!publication) throw new NotFoundError('Publication not found.');

  // The Story must be a real canonical record; we never invent Stories here.
  const story = await new StoryRepository(db).findById(values.storyId);
  if (!story) {
    throw new AdminValidationError('storyId', 'Canonical Story not found.');
  }

  const repo = new PublicationStoryRepository(db);
  if (await repo.findByPublicationAndStory(publicationId, values.storyId)) {
    throw new AdminValidationError(
      'storyId',
      'This Story is already attached to this Publication.',
    );
  }
  const slugClash = await repo.findByPublicationAndSlug(
    publicationId,
    values.slug,
  );
  if (slugClash) {
    throw new AdminValidationError(
      'slug',
      `A Story with slug "${values.slug}" already exists in this Publication.`,
    );
  }

  const created = await repo.create({
    publicationId,
    storyId: values.storyId,
    values: {
      slug: values.slug,
      headline: values.headline ?? null,
      publishedSummary: values.publishedSummary ?? null,
      publishedWhyItMatters: values.publishedWhyItMatters ?? null,
      featured: values.featured,
      editorialPriority: values.editorialPriority,
      suppressRanking: false,
    },
  });

  await new AdminAuditLogRepository(db).record({
    action: 'PUBLICATION_STORY_CREATE',
    actorIdentifier: actor.username,
    targetType: 'publication_story',
    targetId: created.id,
    after: auditPublicationStoryView(created),
    metadata: {
      role: actor.role,
      publication_id: publicationId,
      story_id: values.storyId,
    },
  });
  return created;
}

export async function updatePublicationStory(
  db: Db,
  actor: AdminSession,
  id: string,
  input: unknown,
): Promise<PublicationStoryRow> {
  assertCanMutate(actor);
  const values = updatePublicationStorySchema.parse(input);
  const repo = new PublicationStoryRepository(db);
  const before = await repo.findById(id);
  if (!before) throw new NotFoundError('PublicationStory not found.');

  // Per-Publication slug uniqueness (ignoring this row).
  const slugClash = await repo.findByPublicationAndSlug(
    before.publication_id,
    values.slug,
  );
  if (slugClash && slugClash.id !== id) {
    throw new AdminValidationError(
      'slug',
      `A Story with slug "${values.slug}" already exists in this Publication.`,
    );
  }

  const updated = await repo.update(id, {
    slug: values.slug,
    headline: values.headline ?? null,
    publishedSummary: values.publishedSummary ?? null,
    publishedWhyItMatters: values.publishedWhyItMatters ?? null,
    featured: values.featured,
    editorialPriority: values.editorialPriority,
    suppressRanking: before.suppress_ranking, // Preserve existing value
  });
  if (!updated) throw new NotFoundError('PublicationStory not found.');

  await new AdminAuditLogRepository(db).record({
    action: 'PUBLICATION_STORY_UPDATE',
    actorIdentifier: actor.username,
    targetType: 'publication_story',
    targetId: id,
    before: auditPublicationStoryView(before),
    after: auditPublicationStoryView(updated),
    metadata: { role: actor.role, publication_id: before.publication_id },
  });
  return updated;
}

export async function setPublicationStoryStatus(
  db: Db,
  actor: AdminSession,
  id: string,
  input: unknown,
): Promise<PublicationStoryRow> {
  assertCanMutate(actor);
  const { status } = setPublicationStoryStatusSchema.parse(input);
  const repo = new PublicationStoryRepository(db);
  const before = await repo.findById(id);
  if (!before) throw new NotFoundError('PublicationStory not found.');

  // Publishing requires a slug (the public route resolves by publication slug).
  if (status === 'PUBLISHED' && !before.slug) {
    throw new AdminValidationError(
      'status',
      'A slug is required before a Story can be published.',
    );
  }

  const updated = await repo.setStatus(id, status as PublicationStoryStatus);
  if (!updated) throw new NotFoundError('PublicationStory not found.');

  await new AdminAuditLogRepository(db).record({
    action: 'PUBLICATION_STORY_STATUS_CHANGE',
    actorIdentifier: actor.username,
    targetType: 'publication_story',
    targetId: id,
    before: { status: before.status, published_at: before.published_at },
    after: { status: updated.status, published_at: updated.published_at },
    metadata: {
      role: actor.role,
      publication_id: before.publication_id,
      from: before.status,
      to: updated.status,
    },
  });
  return updated;
}
