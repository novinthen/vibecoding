import type { Db } from '@/db/client';
import { AdminAuditLogRepository, ArticleRepository } from '@/domain';
import type { ArticleRow } from '@/domain/types';

import { assertCanMutate } from '../auth/guard';
import type { AdminSession } from '../auth/session';
import { NotFoundError } from '../errors';
import { updateArticleStatusSchema } from '../validation';

import { auditArticleView } from './audit-view';

/**
 * Article editorial service (Stage 4).
 *
 * The only Article mutation Stage 4 supports is a lifecycle status change (e.g.
 * marking an item HIDDEN or DUPLICATE). Source-supplied facts are never edited
 * here — Article inspection must not become Story editing, and provenance is
 * preserved (only the status column is written).
 */
export async function updateArticleStatus(
  db: Db,
  actor: AdminSession,
  id: string,
  input: unknown,
): Promise<ArticleRow> {
  assertCanMutate(actor);
  const { status } = updateArticleStatusSchema.parse(input);
  const articles = new ArticleRepository(db);
  const before = await articles.findById(id);
  if (!before) throw new NotFoundError('Article not found.');

  const updated = await articles.updateStatus(id, status);
  if (!updated) throw new NotFoundError('Article not found.');

  await new AdminAuditLogRepository(db).record({
    action: 'ARTICLE_STATUS_CHANGE',
    actorIdentifier: actor.username,
    targetType: 'article',
    targetId: id,
    before: auditArticleView(before),
    after: auditArticleView(updated),
    metadata: { role: actor.role, from: before.status, to: updated.status },
  });
  return updated;
}
