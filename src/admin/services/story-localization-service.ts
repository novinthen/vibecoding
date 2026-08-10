import type { Db } from '@/db/client';
import {
  AdminAuditLogRepository,
  PublicationStoryRepository,
  StoryLocalizationRepository,
} from '@/domain';
import type { LocalizationStatus } from '@/domain/enums';
import type { StoryLocalizationRow } from '@/domain/types';

import { assertCanMutate } from '../auth/guard';
import type { AdminSession } from '../auth/session';
import { AdminValidationError, NotFoundError } from '../errors';
import {
  createStoryLocalizationSchema,
  setStoryLocalizationStatusSchema,
  updateStoryLocalizationSchema,
} from '../validation';

import { auditLocalizationView } from './audit-view';

/**
 * StoryLocalization editorial workflow (Stage 5B).
 *
 * Manages locale-specific editorial variants that hang off a PublicationStory
 * (Story → PublicationStory → StoryLocalization). Stage 5B supports MANUAL /
 * editorial localisation and IMPORT of already-translated text with provenance
 * fields — no automated AI translation provider is invoked. Locales are rows
 * keyed by `locale` (one per PublicationStory), never language columns, and a
 * localisation can only ever belong to its parent PublicationStory, so it cannot
 * leak across Publications.
 */

/** REVIEW/PUBLISHED transitions attribute a reviewer; DRAFT/ARCHIVED clear it. */
function reviewerFor(
  status: LocalizationStatus,
  actor: AdminSession,
): string | null {
  return status === 'REVIEW' || status === 'PUBLISHED' ? actor.username : null;
}

export async function createStoryLocalization(
  db: Db,
  actor: AdminSession,
  publicationStoryId: string,
  input: unknown,
): Promise<StoryLocalizationRow> {
  assertCanMutate(actor);
  const values = createStoryLocalizationSchema.parse(input);

  // The parent PublicationStory must exist (Story must be attached first).
  const parent = await new PublicationStoryRepository(db).findById(
    publicationStoryId,
  );
  if (!parent) throw new NotFoundError('PublicationStory not found.');

  const repo = new StoryLocalizationRepository(db);
  if (await repo.findByLocale(publicationStoryId, values.locale)) {
    throw new AdminValidationError(
      'locale',
      `A "${values.locale}" localisation already exists for this Story.`,
    );
  }

  const created = await repo.create({
    publicationStoryId,
    values: {
      locale: values.locale,
      headline: values.headline ?? null,
      summary: values.summary ?? null,
      whyItMatters: values.whyItMatters ?? null,
      translationSource: values.translationSource,
      modelProvider: values.modelProvider ?? null,
      modelName: values.modelName ?? null,
    },
  });

  await new AdminAuditLogRepository(db).record({
    action: 'STORY_LOCALIZATION_CREATE',
    actorIdentifier: actor.username,
    targetType: 'story_localization',
    targetId: created.id,
    after: auditLocalizationView(created),
    metadata: {
      role: actor.role,
      publication_story_id: publicationStoryId,
      locale: values.locale,
    },
  });
  return created;
}

export async function updateStoryLocalization(
  db: Db,
  actor: AdminSession,
  id: string,
  input: unknown,
): Promise<StoryLocalizationRow> {
  assertCanMutate(actor);
  const values = updateStoryLocalizationSchema.parse(input);
  const repo = new StoryLocalizationRepository(db);
  const before = await repo.findById(id);
  if (!before) throw new NotFoundError('StoryLocalization not found.');

  const updated = await repo.update(id, {
    headline: values.headline ?? null,
    summary: values.summary ?? null,
    whyItMatters: values.whyItMatters ?? null,
    translationSource: values.translationSource,
    modelProvider: values.modelProvider ?? null,
    modelName: values.modelName ?? null,
  });
  if (!updated) throw new NotFoundError('StoryLocalization not found.');

  await new AdminAuditLogRepository(db).record({
    action: 'STORY_LOCALIZATION_UPDATE',
    actorIdentifier: actor.username,
    targetType: 'story_localization',
    targetId: id,
    before: auditLocalizationView(before),
    after: auditLocalizationView(updated),
    metadata: {
      role: actor.role,
      publication_story_id: before.publication_story_id,
    },
  });
  return updated;
}

export async function setStoryLocalizationStatus(
  db: Db,
  actor: AdminSession,
  id: string,
  input: unknown,
): Promise<StoryLocalizationRow> {
  assertCanMutate(actor);
  const { status } = setStoryLocalizationStatusSchema.parse(input);
  const repo = new StoryLocalizationRepository(db);
  const before = await repo.findById(id);
  if (!before) throw new NotFoundError('StoryLocalization not found.');

  const updated = await repo.setStatus(
    id,
    status as LocalizationStatus,
    reviewerFor(status as LocalizationStatus, actor),
  );
  if (!updated) throw new NotFoundError('StoryLocalization not found.');

  await new AdminAuditLogRepository(db).record({
    action: 'STORY_LOCALIZATION_STATUS_CHANGE',
    actorIdentifier: actor.username,
    targetType: 'story_localization',
    targetId: id,
    before: { status: before.status, reviewed_by: before.reviewed_by },
    after: { status: updated.status, reviewed_by: updated.reviewed_by },
    metadata: {
      role: actor.role,
      publication_story_id: before.publication_story_id,
      from: before.status,
      to: updated.status,
    },
  });
  return updated;
}
