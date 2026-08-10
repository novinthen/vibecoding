import type { Pool } from 'pg';

import {
  ArticleNotFoundError,
  enrichArticle,
  EnrichmentIneligibleError,
  resolveSuggestions,
  type EnrichArticleOptions,
  type EnrichmentResult,
  type ResolvedSuggestions,
} from '@/ai';
import type { AiProvider } from '@/ai/provider/types';
import type { Db } from '@/db/client';
import { ArticleEnrichmentRepository, AdminAuditLogRepository } from '@/domain';
import type { ArticleEnrichmentRow } from '@/domain/types';

import { assertCanMutate } from '../auth/guard';
import type { AdminSession } from '../auth/session';
import { AdminValidationError, NotFoundError } from '../errors';

import { auditEnrichmentView } from './audit-view';

/**
 * Admin enrichment workflow (Stage 6).
 *
 * Exposes the two admin-facing operations: an authorized, audited manual trigger
 * that runs the enrichment service against one Article, and a read-only review
 * assembly for the Article detail page. The trigger is the only place an editor
 * causes an AI call, keeping cost and execution under explicit human control
 * (no production-wide automation in Stage 6). It never publishes the Article or
 * promotes AI output into a canonical field — it only records a new enrichment
 * version and an audit row.
 */

/**
 * Run enrichment for one Article as an authorized admin action. VIEWERs are
 * refused. The provider is injected so tests use a fake and no live AI call is
 * required. No transaction is passed in or held during the AI call: `enrichArticle`
 * performs the provider request first, then persists the versioned enrichment in
 * its own short transaction — and the audit row is written INSIDE that same
 * transaction via `onPersist`, so the enrichment and its audit record commit
 * atomically. The `outcome` recorded in the audit equals the persisted row's
 * status (SUCCEEDED / INVALID_OUTPUT / PROVIDER_ERROR).
 */
export async function triggerArticleEnrichment(
  actor: AdminSession,
  provider: AiProvider,
  articleId: string,
  options: EnrichArticleOptions = {},
  pool?: Pool,
): Promise<EnrichmentResult> {
  assertCanMutate(actor);

  try {
    return await enrichArticle(provider, articleId, options, {
      pool,
      onPersist: async (tx, enrichment) => {
        await new AdminAuditLogRepository(tx).record({
          action: 'ARTICLE_ENRICHMENT_TRIGGER',
          actorIdentifier: actor.username,
          targetType: 'article',
          targetId: articleId,
          after: auditEnrichmentView(enrichment),
          metadata: {
            role: actor.role,
            outcome: enrichment.status,
            provider: enrichment.model_provider,
            model: enrichment.model_name,
            enrichment_version: enrichment.enrichment_version,
            relevance: enrichment.relevance,
          },
        });
      },
    });
  } catch (error) {
    if (error instanceof ArticleNotFoundError) {
      throw new NotFoundError('Article not found.');
    }
    if (error instanceof EnrichmentIneligibleError) {
      throw new AdminValidationError('form', error.reason);
    }
    throw error;
  }
}

export interface ArticleEnrichmentReview {
  latest: ArticleEnrichmentRow | null;
  history: ArticleEnrichmentRow[];
  /** Resolved suggestions for the latest SUCCEEDED enrichment, if any. */
  suggestions: ResolvedSuggestions | null;
}

/**
 * Assemble the enrichment review for the Article detail page (read-only). Loads
 * the version history and, for the latest successful enrichment, resolves its
 * Topic/Entity suggestions against canonical records WITHOUT creating anything.
 * Authorization is enforced by the admin area guard around the calling route.
 */
export async function getArticleEnrichmentReview(
  db: Db,
  articleId: string,
): Promise<ArticleEnrichmentReview> {
  const repo = new ArticleEnrichmentRepository(db);
  const history = await repo.listByArticle(articleId);
  const latest = history[0] ?? null;

  let suggestions: ResolvedSuggestions | null = null;
  const latestSucceeded = history.find((row) => row.status === 'SUCCEEDED');
  if (latestSucceeded) {
    suggestions = await resolveSuggestions(
      db,
      latestSucceeded.suggested_topics,
      latestSucceeded.suggested_entities,
    );
  }

  return { latest, history, suggestions };
}
