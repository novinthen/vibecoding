import type { Db } from '@/db/client';
import { AdminAuditLogRepository, TopicRepository } from '@/domain';
import { slugify } from '@/domain/slug';
import type { TopicRow } from '@/domain/types';

import { assertCanMutate } from '../auth/guard';
import type { AdminSession } from '../auth/session';
import { AdminValidationError, NotFoundError } from '../errors';
import { createTopicSchema, updateTopicSchema } from '../validation';

import { auditTopicView } from './audit-view';

/**
 * Topic management service (Stage 4).
 *
 * Controlled taxonomy management, scoped conservatively: admins may add a
 * sub-Topic under an existing top-level parent and edit/enable/disable Topics,
 * but the fixed top-level taxonomy (seeded) is not extended here — creating a
 * Topic requires a parent, and that parent must itself be top-level. This
 * respects "do not modify the controlled top-level taxonomy" (CLAUDE.md).
 */

export async function createTopic(
  db: Db,
  actor: AdminSession,
  input: unknown,
): Promise<TopicRow> {
  assertCanMutate(actor);
  const values = createTopicSchema.parse(input);
  const topics = new TopicRepository(db);

  const parent = await topics.findById(values.parentId);
  if (!parent) {
    throw new AdminValidationError('parentId', 'Parent Topic not found.');
  }
  if (parent.parent_id !== null) {
    throw new AdminValidationError(
      'parentId',
      'Sub-Topics may only be nested one level under a top-level Topic.',
    );
  }

  const slug = values.slug ?? slugify(values.name);
  if (slug.length === 0) {
    throw new AdminValidationError(
      'slug',
      'Could not derive a slug from the name.',
    );
  }
  const existing = await topics.findBySlug(slug);
  if (existing) {
    throw new AdminValidationError(
      'slug',
      `A Topic with slug "${slug}" already exists.`,
    );
  }

  const created = await topics.create({
    name: values.name,
    slug,
    description: values.description ?? null,
    parentId: values.parentId,
  });

  await new AdminAuditLogRepository(db).record({
    action: 'TOPIC_CREATE',
    actorIdentifier: actor.username,
    targetType: 'topic',
    targetId: created.id,
    after: auditTopicView(created),
    metadata: { role: actor.role },
  });
  return created;
}

export async function updateTopic(
  db: Db,
  actor: AdminSession,
  id: string,
  input: unknown,
): Promise<TopicRow> {
  assertCanMutate(actor);
  const values = updateTopicSchema.parse(input);
  const topics = new TopicRepository(db);
  const before = await topics.findById(id);
  if (!before) throw new NotFoundError('Topic not found.');

  const updated = await topics.update(id, {
    name: values.name,
    description: values.description ?? null,
  });
  if (!updated) throw new NotFoundError('Topic not found.');

  await new AdminAuditLogRepository(db).record({
    action: 'TOPIC_UPDATE',
    actorIdentifier: actor.username,
    targetType: 'topic',
    targetId: id,
    before: auditTopicView(before),
    after: auditTopicView(updated),
    metadata: { role: actor.role },
  });
  return updated;
}

export async function setTopicEnabled(
  db: Db,
  actor: AdminSession,
  id: string,
  enabled: boolean,
): Promise<TopicRow> {
  assertCanMutate(actor);
  const topics = new TopicRepository(db);
  const before = await topics.findById(id);
  if (!before) throw new NotFoundError('Topic not found.');

  const updated = await topics.setEnabled(id, enabled);
  if (!updated) throw new NotFoundError('Topic not found.');

  await new AdminAuditLogRepository(db).record({
    action: enabled ? 'TOPIC_ENABLE' : 'TOPIC_DISABLE',
    actorIdentifier: actor.username,
    targetType: 'topic',
    targetId: id,
    before: { enabled: before.enabled },
    after: { enabled: updated.enabled },
    metadata: { role: actor.role },
  });
  return updated;
}
