import type { Pool } from 'pg';

import {
  clusterArticle,
  ClusterArticleNotFoundError,
  ClusteringIneligibleError,
  resolveEmbeddingProvider,
  CLUSTERING_METHOD,
  SCORING_VERSION,
} from '@/clustering';
import { ensureArticleEmbedding } from '@/clustering/embedding/service';
import type { EmbeddingProvider } from '@/clustering/embedding/types';
import { getPool, withTransaction, type Db } from '@/db/client';
import {
  AdminAuditLogRepository,
  ArticleRepository,
  ClusteringDecisionRepository,
  StoryEmbeddingRepository,
  StoryRepository,
  slugify,
} from '@/domain';
import {
  storyArticleRelationshipSchema,
  storyReviewStateSchema,
  type StoryArticleRelationship,
  type StoryReviewState,
} from '@/domain/enums';
import type {
  ClusteringDecisionRow,
  StoryArticleRow,
  StoryRow,
} from '@/domain/types';

import { assertCanMutate } from '../auth/guard';
import type { AdminSession } from '../auth/session';
import { AdminValidationError, NotFoundError } from '../errors';

import {
  auditArticleView,
  auditClusteringDecisionView,
  auditStoryView,
} from './audit-view';

/**
 * Admin clustering workflow (Stage 7).
 *
 * Exposes the reviewable clustering surface and a small set of JUSTIFIED,
 * authorized, audited mutations: run clustering for an Article, attach/detach an
 * Article, create a Story from an Article, move an Article between Stories, and
 * set a Story's review state. Every mutation asserts the actor may mutate
 * (VIEWERs refused) and writes an admin_audit_log row in the SAME transaction as
 * the change. None of these operations ever edits an Article source fact, and
 * none publishes a Story — publishing stays the explicit PublicationStory
 * boundary. This is deliberately not a full newsroom CMS.
 */

// ---------------------------------------------------------------------------
// Read views (authorization enforced by the admin-area guard around the route).
// ---------------------------------------------------------------------------

export interface StoryMember {
  membership: StoryArticleRow;
  article: {
    id: string;
    original_title: string;
    url: string;
    status: string;
    published_at: string | null;
    source_id: string;
    source_name: string | null;
  };
}

export interface StoryClusteringView {
  story: StoryRow;
  members: StoryMember[];
  decisions: ClusteringDecisionRow[];
  /** Distinct Source count across members (source diversity). */
  sourceCount: number;
}

/** Assemble the clustering review for one Story (members + decisions + diversity). */
export async function getStoryClusteringView(
  db: Db,
  storyId: string,
): Promise<StoryClusteringView | null> {
  const story = await new StoryRepository(db).findById(storyId);
  if (!story) return null;

  const membersResult = await db.query<
    StoryArticleRow & {
      original_title: string;
      url: string;
      article_status: string;
      published_at: string | null;
      source_id: string;
      source_name: string | null;
    }
  >(
    `SELECT sa.*, a.original_title, a.url, a.status AS article_status,
            a.published_at, a.source_id, src.name AS source_name
     FROM story_articles sa
     JOIN articles a ON a.id = sa.article_id
     LEFT JOIN sources src ON src.id = a.source_id
     WHERE sa.story_id = $1
     ORDER BY (sa.relationship_type = 'PRIMARY') DESC, sa.created_at ASC`,
    [storyId],
  );

  const members: StoryMember[] = membersResult.rows.map((row) => ({
    membership: {
      story_id: row.story_id,
      article_id: row.article_id,
      relationship_type: row.relationship_type,
      confidence: row.confidence,
      assignment_source: row.assignment_source,
      clustering_method: row.clustering_method,
      clustering_version: row.clustering_version,
      score: row.score,
      decision_reason: row.decision_reason,
      signals: row.signals,
      created_at: row.created_at,
    },
    article: {
      id: row.article_id,
      original_title: row.original_title,
      url: row.url,
      status: row.article_status,
      published_at: row.published_at,
      source_id: row.source_id,
      source_name: row.source_name,
    },
  }));

  const sourceCount = new Set(members.map((m) => m.article.source_id)).size;
  const decisions = await new ClusteringDecisionRepository(db).listByStory(
    storyId,
  );
  return { story, members, decisions, sourceCount };
}

export interface ArticleClusteringView {
  memberships: { story: StoryRow; membership: StoryArticleRow }[];
  decisions: ClusteringDecisionRow[];
}

/** Assemble the clustering review for one Article (its Stories + decision log). */
export async function getArticleClusteringView(
  db: Db,
  articleId: string,
): Promise<ArticleClusteringView> {
  const stories = new StoryRepository(db);
  const storyIds = await stories.listStoryIdsForArticle(articleId);
  const memberships: { story: StoryRow; membership: StoryArticleRow }[] = [];
  for (const storyId of storyIds) {
    const story = await stories.findById(storyId);
    if (!story) continue;
    const rows = await stories.listMemberships(storyId);
    const membership = rows.find((r) => r.article_id === articleId);
    if (membership) memberships.push({ story, membership });
  }
  const decisions = await new ClusteringDecisionRepository(db).listByArticle(
    articleId,
  );
  return { memberships, decisions };
}

// ---------------------------------------------------------------------------
// Mutations (authorized + audited).
// ---------------------------------------------------------------------------

/**
 * Run clustering for one Article as an authorized admin action. VIEWERs are
 * refused. The decision (and any Story change) plus its audit row commit
 * atomically via `onDecision`. Mirrors the enrichment trigger: the provider call
 * happens first with no DB transaction held.
 */
export async function triggerArticleClustering(
  actor: AdminSession,
  articleId: string,
  options: { force?: boolean; bypassEligibility?: boolean } = {},
  deps: { pool?: Pool; provider?: EmbeddingProvider } = {},
): Promise<ClusteringDecisionRow> {
  assertCanMutate(actor);
  try {
    const result = await clusterArticle(
      articleId,
      {
        force: options.force,
        bypassEligibility: options.bypassEligibility,
        decisionSource: 'MANUAL',
      },
      {
        pool: deps.pool,
        embeddingProvider: deps.provider,
        onDecision: async (tx, decision, story) => {
          await new AdminAuditLogRepository(tx).record({
            action: 'STORY_CLUSTER_ARTICLE',
            actorIdentifier: actor.username,
            targetType: 'article',
            targetId: articleId,
            after: {
              ...auditClusteringDecisionView(decision),
              story: story ? auditStoryView(story) : null,
            },
            metadata: {
              role: actor.role,
              decision: decision.decision,
              story_id: decision.story_id,
            },
          });
        },
      },
    );
    return result.decision;
  } catch (error) {
    if (error instanceof ClusterArticleNotFoundError) {
      throw new NotFoundError('Article not found.');
    }
    if (error instanceof ClusteringIneligibleError) {
      throw new AdminValidationError('form', error.reason);
    }
    throw error;
  }
}

/**
 * Manually attach an Article to a Story (explicit editorial action). Allowed even
 * for REVIEWED/LOCKED Stories because it is a deliberate, audited human decision —
 * the protection only blocks AUTOMATIC changes. Idempotent on (story, article).
 */
export async function attachArticleToStory(
  db: Db,
  actor: AdminSession,
  input: { storyId: string; articleId: string; relationship?: unknown },
): Promise<void> {
  assertCanMutate(actor);
  const relationship = parseRelationship(input.relationship);
  const stories = new StoryRepository(db);
  const story = await stories.findById(input.storyId);
  if (!story) throw new NotFoundError('Story not found.');
  const article = await new ArticleRepository(db).findById(input.articleId);
  if (!article) throw new NotFoundError('Article not found.');

  const inserted = await stories.attachArticle(input.storyId, input.articleId, {
    relationshipType: relationship,
    assignmentSource: 'MANUAL',
    clusteringMethod: CLUSTERING_METHOD,
    clusteringVersion: SCORING_VERSION,
    decisionReason: `Manually attached by ${actor.username}.`,
  });
  await stories.touchActivity(input.storyId, article.published_at);

  await new AdminAuditLogRepository(db).record({
    action: 'STORY_ARTICLE_ATTACH',
    actorIdentifier: actor.username,
    targetType: 'story',
    targetId: input.storyId,
    after: { article: auditArticleView(article), relationship },
    metadata: { role: actor.role, inserted, article_id: input.articleId },
  });
}

/** Detach an Article from a Story (audited). Clears the primary pointer if it matched. */
export async function detachArticleFromStory(
  db: Db,
  actor: AdminSession,
  input: { storyId: string; articleId: string },
): Promise<void> {
  assertCanMutate(actor);
  const stories = new StoryRepository(db);
  const story = await stories.findById(input.storyId);
  if (!story) throw new NotFoundError('Story not found.');

  const removed = await stories.detachArticle(input.storyId, input.articleId);
  if (!removed) {
    throw new AdminValidationError(
      'form',
      'Article is not attached to this Story.',
    );
  }
  await stories.clearPrimaryArticleIfMatches(input.storyId, input.articleId);

  await new AdminAuditLogRepository(db).record({
    action: 'STORY_ARTICLE_DETACH',
    actorIdentifier: actor.username,
    targetType: 'story',
    targetId: input.storyId,
    before: { article_id: input.articleId },
    metadata: { role: actor.role, article_id: input.articleId },
  });
}

/**
 * Move an Article from one Story to another in a single audited step. Refuses to
 * "move" onto the same Story. Detach + attach are one transaction so the Article
 * is never briefly orphaned or duplicated.
 */
export async function moveArticleBetweenStories(
  db: Db,
  actor: AdminSession,
  input: {
    fromStoryId: string;
    toStoryId: string;
    articleId: string;
    relationship?: unknown;
  },
): Promise<void> {
  assertCanMutate(actor);
  if (input.fromStoryId === input.toStoryId) {
    throw new AdminValidationError(
      'form',
      'Source and target Story are the same.',
    );
  }
  const relationship = parseRelationship(input.relationship);
  const stories = new StoryRepository(db);
  const from = await stories.findById(input.fromStoryId);
  if (!from) throw new NotFoundError('Source Story not found.');
  const to = await stories.findById(input.toStoryId);
  if (!to) throw new NotFoundError('Target Story not found.');
  const article = await new ArticleRepository(db).findById(input.articleId);
  if (!article) throw new NotFoundError('Article not found.');

  const removed = await stories.detachArticle(
    input.fromStoryId,
    input.articleId,
  );
  if (!removed) {
    throw new AdminValidationError(
      'form',
      'Article is not attached to the source Story.',
    );
  }
  await stories.clearPrimaryArticleIfMatches(
    input.fromStoryId,
    input.articleId,
  );
  await stories.attachArticle(input.toStoryId, input.articleId, {
    relationshipType: relationship,
    assignmentSource: 'MANUAL',
    clusteringMethod: CLUSTERING_METHOD,
    clusteringVersion: SCORING_VERSION,
    decisionReason: `Manually moved from Story ${input.fromStoryId} by ${actor.username}.`,
  });
  await stories.touchActivity(input.toStoryId, article.published_at);

  await new AdminAuditLogRepository(db).record({
    action: 'STORY_ARTICLE_MOVE',
    actorIdentifier: actor.username,
    targetType: 'story',
    targetId: input.toStoryId,
    before: { from_story_id: input.fromStoryId },
    after: {
      to_story_id: input.toStoryId,
      article_id: input.articleId,
      relationship,
    },
    metadata: { role: actor.role, article_id: input.articleId },
  });
}

/** Set a Story's clustering review state (protects it from auto-restructuring). */
export async function setStoryReviewState(
  db: Db,
  actor: AdminSession,
  input: { storyId: string; reviewState: unknown },
): Promise<StoryRow> {
  assertCanMutate(actor);
  const parsed = storyReviewStateSchema.safeParse(input.reviewState);
  if (!parsed.success) {
    throw new AdminValidationError('reviewState', 'Invalid review state.');
  }
  const reviewState: StoryReviewState = parsed.data;
  const stories = new StoryRepository(db);
  const before = await stories.findById(input.storyId);
  if (!before) throw new NotFoundError('Story not found.');
  const updated = await stories.updateReviewState(input.storyId, reviewState);
  if (!updated) throw new NotFoundError('Story not found.');

  await new AdminAuditLogRepository(db).record({
    action: 'STORY_REVIEW_STATE',
    actorIdentifier: actor.username,
    targetType: 'story',
    targetId: input.storyId,
    before: auditStoryView(before),
    after: auditStoryView(updated),
    metadata: { role: actor.role, from: before.review_state, to: reviewState },
  });
  return updated;
}

/**
 * Manually create a NEW Story seeded from one Article (formation MANUAL). Unlike
 * the automatic engine this always forms a fresh Story for the Article regardless
 * of candidates — the editor's explicit intent. The Article's embedding is ensured
 * first (no DB transaction held), then the Story, membership, representative
 * embedding, entity copy, decision log, and audit row commit atomically.
 */
export async function createStoryFromArticle(
  actor: AdminSession,
  articleId: string,
  deps: { pool?: Pool; provider?: EmbeddingProvider } = {},
): Promise<StoryRow> {
  assertCanMutate(actor);
  const pool = deps.pool ?? getPool();
  const provider = deps.provider ?? resolveEmbeddingProvider();

  const article = await new ArticleRepository(pool).findById(articleId);
  if (!article) throw new NotFoundError('Article not found.');

  const embedding = await ensureArticleEmbedding(pool, provider, article);
  const title = (
    article.normalized_title ||
    article.original_title ||
    'Story'
  ).trim();
  const slug = `${slugify(title).slice(0, 80) || 'story'}-${crypto
    .randomUUID()
    .slice(0, 8)}`;

  return withTransaction(async (tx) => {
    const stories = new StoryRepository(tx);
    const story = await stories.createClustered({
      slug,
      canonicalTitle: title,
      primaryArticleId: article.id,
      formationSource: 'MANUAL',
      clusteringMethod: CLUSTERING_METHOD,
      clusteringVersion: SCORING_VERSION,
      lastActivityAt: article.published_at,
    });
    await stories.attachArticle(story.id, article.id, {
      relationshipType: 'PRIMARY',
      assignmentSource: 'MANUAL',
      clusteringMethod: CLUSTERING_METHOD,
      clusteringVersion: SCORING_VERSION,
      decisionReason: `Story manually created from this Article by ${actor.username}.`,
    });
    await new StoryEmbeddingRepository(tx).upsert(story.id, {
      provider: provider.name,
      model: provider.model,
      version: provider.version,
      dimensions: provider.dimensions,
      embedding: embedding.vector,
      sourceContentHash: embedding.row.source_content_hash ?? '',
    });
    await tx.query(
      `INSERT INTO story_entities (story_id, entity_id, relationship)
       SELECT $1, ae.entity_id, 'MENTION' FROM article_entities ae
       WHERE ae.article_id = $2
       ON CONFLICT (story_id, entity_id) DO NOTHING`,
      [story.id, article.id],
    );
    await new ClusteringDecisionRepository(tx).record({
      articleId: article.id,
      storyId: story.id,
      method: CLUSTERING_METHOD,
      methodVersion: SCORING_VERSION,
      embeddingProvider: provider.name,
      embeddingModel: provider.model,
      embeddingVersion: provider.version,
      decision: 'CREATED_STORY',
      decisionSource: 'MANUAL',
      reason: `Manually created by ${actor.username}.`,
    });
    await new AdminAuditLogRepository(tx).record({
      action: 'STORY_CREATE_FROM_ARTICLE',
      actorIdentifier: actor.username,
      targetType: 'story',
      targetId: story.id,
      after: auditStoryView(story),
      metadata: { role: actor.role, article_id: article.id },
    });
    return story;
  }, pool);
}

function parseRelationship(value: unknown): StoryArticleRelationship {
  if (value === undefined || value === null || value === '') return 'RELATED';
  const parsed = storyArticleRelationshipSchema.safeParse(value);
  if (!parsed.success) {
    throw new AdminValidationError(
      'relationship',
      'Invalid relationship type.',
    );
  }
  return parsed.data;
}
