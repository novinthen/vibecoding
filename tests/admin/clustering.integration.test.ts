import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { FakeEmbeddingProvider } from '@/clustering/embedding/fake-provider';
import {
  attachArticleToStory,
  createStoryFromArticle,
  detachArticleFromStory,
  getArticleClusteringView,
  getStoryClusteringView,
  moveArticleBetweenStories,
  setStoryReviewState,
  triggerArticleClustering,
} from '@/admin/services/clustering-service';
import { UnauthorizedError } from '@/admin/auth/guard';
import type { AdminSession } from '@/admin/auth/session';
import { closePool, getPool, withTransaction, type Db } from '@/db/client';
import { migrate } from '@/db/migrate';
import { ArticleRepository, StoryRepository } from '@/domain';
import type { ArticleRow } from '@/domain/types';

/**
 * Admin clustering service integration tests (DATABASE_URL-gated). Verify
 * authorization (VIEWER refused), audit logging, and the manual operations —
 * all with the deterministic fake embedding provider (no live API).
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const provider = new FakeEmbeddingProvider();

const EDITOR: AdminSession = { username: 'ed', role: 'EDITOR', iat: 0, exp: 0 };
const VIEWER: AdminSession = { username: 'vi', role: 'VIEWER', iat: 0, exp: 0 };

const createdArticleIds: string[] = [];
const createdSourceIds: string[] = [];
const createdStoryIds: string[] = [];

async function seedArticle(title: string): Promise<ArticleRow> {
  const pool = getPool();
  const source = await pool.query<{ id: string }>(
    `INSERT INTO sources (name, slug, source_type, authority_tier)
     VALUES ('S', 'adm-clu-' || gen_random_uuid(), 'RSS', 'TRUSTED')
     RETURNING id`,
  );
  const sourceId = source.rows[0]!.id;
  createdSourceIds.push(sourceId);
  const article = await new ArticleRepository(pool).create({
    sourceId,
    url: `https://example.com/${crypto.randomUUID()}`,
    originalTitle: title,
    publishedAt: '2026-03-01T00:00:00.000Z',
  });
  createdArticleIds.push(article.id);
  return article;
}

function track(storyId: string): string {
  createdStoryIds.push(storyId);
  return storyId;
}

async function auditCount(
  db: Db,
  action: string,
  targetId: string,
): Promise<number> {
  const r = await db.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM admin_audit_log WHERE action = $1 AND target_id = $2',
    [action, targetId],
  );
  return Number(r.rows[0]?.n ?? '0');
}

describe.skipIf(!hasDb)('admin clustering service (integration)', () => {
  beforeAll(async () => {
    await migrate();
  });
  afterAll(async () => {
    await closePool();
  });
  afterEach(async () => {
    const pool = getPool();
    for (const id of createdStoryIds.splice(0))
      await pool.query('DELETE FROM stories WHERE id = $1', [id]);
    for (const id of createdArticleIds.splice(0))
      await pool.query('DELETE FROM articles WHERE id = $1', [id]);
    for (const id of createdSourceIds.splice(0))
      await pool.query('DELETE FROM sources WHERE id = $1', [id]);
  });

  it('refuses every mutation for a VIEWER', async () => {
    const article = await seedArticle('Viewer denied clustering');
    await expect(
      triggerArticleClustering(VIEWER, article.id, {}, { provider }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(
      createStoryFromArticle(VIEWER, article.id, { provider }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(
      withTransaction((tx) =>
        setStoryReviewState(tx, VIEWER, {
          storyId: crypto.randomUUID(),
          reviewState: 'REVIEWED',
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('triggers clustering and writes an audit row', async () => {
    const article = await seedArticle('Editor triggers clustering alpha');
    const decision = await triggerArticleClustering(
      EDITOR,
      article.id,
      {},
      { provider },
    );
    if (decision.story_id) track(decision.story_id);
    expect(decision.decision).toBe('CREATED_STORY');
    expect(decision.decision_source).toBe('MANUAL');
    expect(
      await auditCount(getPool(), 'STORY_CLUSTER_ARTICLE', article.id),
    ).toBe(1);
  });

  it('manually creates a Story from an Article (formation MANUAL, audited)', async () => {
    const article = await seedArticle('Manual story creation beta');
    const story = await createStoryFromArticle(EDITOR, article.id, {
      provider,
    });
    track(story.id);
    expect(story.formation_source).toBe('MANUAL');
    expect(story.primary_article_id).toBe(article.id);
    expect(
      await auditCount(getPool(), 'STORY_CREATE_FROM_ARTICLE', story.id),
    ).toBe(1);
    // The Article is a member and a clustering decision was logged.
    const view = await getArticleClusteringView(getPool(), article.id);
    expect(view.memberships).toHaveLength(1);
    expect(view.decisions[0]?.decision_source).toBe('MANUAL');
  });

  it('attaches and detaches an Article with audit rows', async () => {
    const seed = await seedArticle('Attach seed gamma');
    const story = await createStoryFromArticle(EDITOR, seed.id, { provider });
    track(story.id);
    const other = await seedArticle('Attach target article gamma');

    await withTransaction((tx) =>
      attachArticleToStory(tx, EDITOR, {
        storyId: story.id,
        articleId: other.id,
        relationship: 'SUPPORTING',
      }),
    );
    let view = await getStoryClusteringView(getPool(), story.id);
    expect(view?.members).toHaveLength(2);
    expect(await auditCount(getPool(), 'STORY_ARTICLE_ATTACH', story.id)).toBe(
      1,
    );

    await withTransaction((tx) =>
      detachArticleFromStory(tx, EDITOR, {
        storyId: story.id,
        articleId: other.id,
      }),
    );
    view = await getStoryClusteringView(getPool(), story.id);
    expect(view?.members).toHaveLength(1);
    expect(await auditCount(getPool(), 'STORY_ARTICLE_DETACH', story.id)).toBe(
      1,
    );
  });

  it('moves an Article between Stories in one audited step', async () => {
    const a1 = await seedArticle('Move source story delta');
    const a2 = await seedArticle('Move target story delta');
    const from = await createStoryFromArticle(EDITOR, a1.id, { provider });
    const to = await createStoryFromArticle(EDITOR, a2.id, { provider });
    track(from.id);
    track(to.id);
    const mover = await seedArticle('Mover article delta');
    await withTransaction((tx) =>
      attachArticleToStory(tx, EDITOR, {
        storyId: from.id,
        articleId: mover.id,
      }),
    );

    await withTransaction((tx) =>
      moveArticleBetweenStories(tx, EDITOR, {
        fromStoryId: from.id,
        toStoryId: to.id,
        articleId: mover.id,
      }),
    );
    const fromView = await getStoryClusteringView(getPool(), from.id);
    const toView = await getStoryClusteringView(getPool(), to.id);
    expect(fromView?.members.some((m) => m.article.id === mover.id)).toBe(
      false,
    );
    expect(toView?.members.some((m) => m.article.id === mover.id)).toBe(true);
    expect(await auditCount(getPool(), 'STORY_ARTICLE_MOVE', to.id)).toBe(1);
  });

  it('sets a Story review state and records before/after audit', async () => {
    const article = await seedArticle('Review state story epsilon');
    const story = await createStoryFromArticle(EDITOR, article.id, {
      provider,
    });
    track(story.id);
    const updated = await withTransaction((tx) =>
      setStoryReviewState(tx, EDITOR, {
        storyId: story.id,
        reviewState: 'LOCKED',
      }),
    );
    expect(updated.review_state).toBe('LOCKED');
    const persisted = await new StoryRepository(getPool()).findById(story.id);
    expect(persisted?.review_state).toBe('LOCKED');
    expect(await auditCount(getPool(), 'STORY_REVIEW_STATE', story.id)).toBe(1);
  });

  it('rejects moving an Article onto the same Story', async () => {
    const article = await seedArticle('Same story move zeta');
    const story = await createStoryFromArticle(EDITOR, article.id, {
      provider,
    });
    track(story.id);
    await expect(
      withTransaction((tx) =>
        moveArticleBetweenStories(tx, EDITOR, {
          fromStoryId: story.id,
          toStoryId: story.id,
          articleId: article.id,
        }),
      ),
    ).rejects.toThrow();
  });
});
