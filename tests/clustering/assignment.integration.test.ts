import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  clusterArticle,
  CLUSTERING_LOCK_NAMESPACE,
  ClusterArticleNotFoundError,
  ClusteringIneligibleError,
} from '@/clustering';
import { FakeEmbeddingProvider } from '@/clustering/embedding/fake-provider';
import { ensureArticleEmbedding } from '@/clustering/embedding/service';
import { closePool, getPool, type Db } from '@/db/client';
import { migrate } from '@/db/migrate';
import {
  ArticleRepository,
  StoryEmbeddingRepository,
  StoryRepository,
} from '@/domain';
import type { ArticleRow } from '@/domain/types';

/**
 * Assignment engine integration tests (DATABASE_URL-gated), driven entirely by
 * the deterministic fake embedding provider — no live API. Each test seeds and
 * cleans its own rows; titles carry a unique tag so one test's Stories are never
 * candidates for another's Article.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const provider = new FakeEmbeddingProvider();
const deps = { embeddingProvider: provider };

const createdArticleIds: string[] = [];
const createdSourceIds: string[] = [];
const createdStoryIds: string[] = [];

function tag(): string {
  return crypto.randomUUID().slice(0, 8);
}

async function seedArticle(
  title: string,
  overrides: { publishedAt?: string; status?: string; excerpt?: string } = {},
): Promise<ArticleRow> {
  const pool = getPool();
  const source = await pool.query<{ id: string }>(
    `INSERT INTO sources (name, slug, source_type, authority_tier)
     VALUES ('S', 'clu-src-' || gen_random_uuid(), 'RSS', 'TRUSTED')
     RETURNING id`,
  );
  const sourceId = source.rows[0]!.id;
  createdSourceIds.push(sourceId);
  let article = await new ArticleRepository(pool).create({
    sourceId,
    url: `https://example.com/${crypto.randomUUID()}`,
    originalTitle: title,
    originalExcerpt: overrides.excerpt ?? null,
    publishedAt: overrides.publishedAt ?? '2026-02-01T12:00:00.000Z',
  });
  if (overrides.status) {
    const updated = await pool.query<ArticleRow>(
      'UPDATE articles SET status = $2 WHERE id = $1 RETURNING *',
      [article.id, overrides.status],
    );
    article = updated.rows[0]!;
  }
  createdArticleIds.push(article.id);
  return article;
}

/** Manually seed a Story anchored on a fresh Article (bypasses the engine). */
async function seedStory(
  title: string,
  opts: { reviewState?: 'REVIEWED' | 'LOCKED'; publishedAt?: string } = {},
): Promise<{ storyId: string; article: ArticleRow }> {
  const pool = getPool();
  const article = await seedArticle(title, { publishedAt: opts.publishedAt });
  const emb = await ensureArticleEmbedding(pool, provider, article);
  const stories = new StoryRepository(pool);
  const story = await stories.createClustered({
    slug: `seed-${tag()}`,
    canonicalTitle: title,
    primaryArticleId: article.id,
    lastActivityAt: opts.publishedAt ?? '2026-02-01T12:00:00.000Z',
  });
  createdStoryIds.push(story.id);
  await stories.attachArticle(story.id, article.id, {
    relationshipType: 'PRIMARY',
  });
  await new StoryEmbeddingRepository(pool).upsert(story.id, {
    provider: provider.name,
    model: provider.model,
    version: provider.version,
    dimensions: provider.dimensions,
    embedding: emb.vector,
    sourceContentHash: 'x',
  });
  if (opts.reviewState)
    await stories.updateReviewState(story.id, opts.reviewState);
  return { storyId: story.id, article };
}

async function memberCount(db: Db, storyId: string): Promise<number> {
  const r = await db.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM story_articles WHERE story_id = $1',
    [storyId],
  );
  return Number(r.rows[0]?.n ?? '0');
}

describe.skipIf(!hasDb)('clusterArticle (integration)', () => {
  beforeAll(async () => {
    await migrate();
  });
  afterAll(async () => {
    await closePool();
  });
  afterEach(async () => {
    const pool = getPool();
    // Order matters: decisions/memberships cascade from articles/stories.
    for (const id of createdStoryIds.splice(0))
      await pool.query('DELETE FROM stories WHERE id = $1', [id]);
    for (const id of createdArticleIds.splice(0))
      await pool.query('DELETE FROM articles WHERE id = $1', [id]);
    for (const id of createdSourceIds.splice(0))
      await pool.query('DELETE FROM sources WHERE id = $1', [id]);
  });

  it('forms a new Story for an unmatched Article (DRAFT, unreviewed, unpublished)', async () => {
    const t = tag();
    const article = await seedArticle(
      `Brandnew ${t} isolated launch event alpha`,
    );
    const result = await clusterArticle(article.id, {}, deps);

    expect(result.decision.decision).toBe('CREATED_STORY');
    expect(result.story).not.toBeNull();
    expect(result.story?.status).toBe('DRAFT');
    expect(result.story?.review_state).toBe('UNREVIEWED');
    expect(result.story?.formation_source).toBe('AUTOMATIC');
    expect(result.story?.primary_article_id).toBe(article.id);
    // Never published by clustering.
    const pub = await getPool().query<{ n: string }>(
      'SELECT count(*)::text AS n FROM publication_stories WHERE story_id = $1',
      [result.story!.id],
    );
    expect(pub.rows[0]?.n).toBe('0');
  });

  it('assigns a near-identical Article to the existing Story (no duplicate Story)', async () => {
    const t = tag();
    const title = `Anthropic ${t} launches Claude Code capability for developers`;
    const seed = await seedStory(title);
    const article = await seedArticle(`${title} today`);

    const result = await clusterArticle(article.id, {}, deps);
    expect(result.decision.decision).toBe('ASSIGNED_EXISTING');
    expect(result.story?.id).toBe(seed.storyId);
    expect(result.decision.confidence).toBeGreaterThanOrEqual(0.72);
    expect(await memberCount(getPool(), seed.storyId)).toBe(2);
  });

  it('keeps unrelated Articles in separate Stories', async () => {
    const t = tag();
    const a = await seedArticle(
      `Alpha ${t} anthropic claude code release notes`,
    );
    const b = await seedArticle(
      `Beta ${t} quarterly hummus recipe cooking guide`,
    );
    const ra = await clusterArticle(a.id, {}, deps);
    const rb = await clusterArticle(b.id, {}, deps);
    expect(ra.decision.decision).toBe('CREATED_STORY');
    expect(rb.decision.decision).toBe('CREATED_STORY');
    expect(ra.story?.id).not.toBe(rb.story?.id);
  });

  it('is idempotent: re-running an already-clustered Article makes no change', async () => {
    const t = tag();
    const article = await seedArticle(
      `Solo ${t} idempotent clustering probe gamma`,
    );
    const first = await clusterArticle(article.id, {}, deps);
    expect(first.decision.decision).toBe('CREATED_STORY');
    const storyId = first.story!.id;

    const second = await clusterArticle(article.id, {}, deps);
    expect(second.decision.decision).toBe('SKIPPED_EXISTING');
    expect(second.story).toBeNull();

    const stories = await getPool().query<{ n: string }>(
      'SELECT count(*)::text AS n FROM stories WHERE id = $1',
      [storyId],
    );
    expect(stories.rows[0]?.n).toBe('1');
    // The same Article is never linked to the same Story twice.
    expect(await memberCount(getPool(), storyId)).toBe(1);
  });

  it('never links the same Article to the same Story twice (force re-attach is a no-op)', async () => {
    const t = tag();
    const title = `Repeat ${t} anthropic claude code duplicate guard delta`;
    const seed = await seedStory(title);
    const article = await seedArticle(`${title} extended`);
    await clusterArticle(article.id, {}, deps); // ASSIGNED_EXISTING
    // Force a re-run: candidate scoring runs again but the PK prevents a dup row.
    await clusterArticle(article.id, { force: true }, deps);
    expect(await memberCount(getPool(), seed.storyId)).toBe(2);
  });

  it('handles concurrent clustering of one Article without duplicate Stories', async () => {
    const t = tag();
    const article = await seedArticle(
      `Race ${t} concurrent clustering safety epsilon`,
    );
    const results = await Promise.all(
      Array.from({ length: 6 }, () => clusterArticle(article.id, {}, deps)),
    );
    const created = results.filter(
      (r) => r.decision.decision === 'CREATED_STORY',
    );
    const skipped = results.filter(
      (r) => r.decision.decision === 'SKIPPED_EXISTING',
    );
    // Exactly one attempt creates the Story; the rest see it and skip.
    expect(created).toHaveLength(1);
    expect(skipped).toHaveLength(5);
    const storyIds = new Set(
      results.map((r) => r.story?.id).filter((id): id is string => Boolean(id)),
    );
    expect(storyIds.size).toBe(1);
    expect(await memberCount(getPool(), created[0]!.story!.id)).toBe(1);
  });

  it('refuses to merge when two Stories match within the ambiguity margin', async () => {
    const t = tag();
    const title = `Ambi ${t} anthropic claude code ambiguous twins zeta`;
    // Two distinct Stories with identical representative text.
    const s1 = await seedStory(title);
    const s2 = await seedStory(title);
    const article = await seedArticle(title);

    const result = await clusterArticle(article.id, {}, deps);
    expect(result.decision.decision).toBe('AMBIGUOUS');
    expect(result.story).toBeNull();
    // The Article stays unclustered (false split > false merge).
    const membership = await getPool().query<{ n: string }>(
      'SELECT count(*)::text AS n FROM story_articles WHERE article_id = $1',
      [article.id],
    );
    expect(membership.rows[0]?.n).toBe('0');
    expect(result.decision.candidate_count).toBeGreaterThanOrEqual(2);
    // Neither Story gained a member.
    expect(await memberCount(getPool(), s1.storyId)).toBe(1);
    expect(await memberCount(getPool(), s2.storyId)).toBe(1);
  });

  it('never auto-modifies a REVIEWED Story (protection)', async () => {
    const t = tag();
    const title = `Protected ${t} anthropic claude code reviewed lock eta`;
    const seed = await seedStory(title, { reviewState: 'REVIEWED' });
    const article = await seedArticle(`${title} coverage`);

    const result = await clusterArticle(article.id, {}, deps);
    expect(result.decision.decision).toBe('SKIPPED_PROTECTED');
    // The reviewed Story is untouched; the Article stays unclustered.
    expect(await memberCount(getPool(), seed.storyId)).toBe(1);
  });

  it('never modifies Article source facts', async () => {
    const t = tag();
    const article = await seedArticle(
      `Facts ${t} immutable source article theta`,
    );
    await clusterArticle(article.id, {}, deps);
    const after = await new ArticleRepository(getPool()).findById(article.id);
    expect(after?.original_title).toBe(article.original_title);
    expect(after?.status).toBe(article.status);
    expect(String(after?.updated_at)).toBe(String(article.updated_at));
  });

  it('records an auditable decision with method/version and candidate provenance', async () => {
    const t = tag();
    const title = `Prov ${t} anthropic claude code provenance iota`;
    await seedStory(title);
    const article = await seedArticle(`${title} follow-up`);
    const result = await clusterArticle(article.id, {}, deps);

    expect(result.decision.method).toBe('deterministic');
    expect(result.decision.method_version).toBe('cluster-score-v1');
    expect(result.decision.embedding_provider).toBe('fake');
    expect(result.decision.embedding_version).toBe(1);
    expect(result.decision.candidates.length).toBeGreaterThanOrEqual(1);
    expect(result.decision.candidates[0]?.signals.embedding).toBeGreaterThan(0);
  });

  it('throws for a missing Article and for an ineligible one', async () => {
    await expect(
      clusterArticle(crypto.randomUUID(), {}, deps),
    ).rejects.toBeInstanceOf(ClusterArticleNotFoundError);
    const hidden = await seedArticle('Hidden article kappa', {
      status: 'HIDDEN',
    });
    await expect(clusterArticle(hidden.id, {}, deps)).rejects.toBeInstanceOf(
      ClusteringIneligibleError,
    );
    // bypassEligibility lets an explicit admin override proceed.
    const forced = await clusterArticle(
      hidden.id,
      { bypassEligibility: true },
      deps,
    );
    expect(forced.decision.decision).toBe('CREATED_STORY');
  });

  it('serialises clustering per-Article via the advisory lock', async () => {
    const t = tag();
    const article = await seedArticle(
      `Lock ${t} advisory serialisation lambda`,
    );
    const lockClient = await getPool().connect();
    let pending: Promise<{ decision: { decision: string } }>;
    try {
      await lockClient.query('BEGIN');
      await lockClient.query(
        'SELECT pg_advisory_xact_lock($1, hashtext($2::text))',
        [CLUSTERING_LOCK_NAMESPACE, article.id],
      );
      // Start clustering while the lock is held elsewhere: it must block in its
      // own apply transaction rather than proceed.
      pending = clusterArticle(article.id, {}, deps);
      const raced = await Promise.race([
        pending.then(() => 'resolved' as const),
        new Promise<'pending'>((r) => setTimeout(() => r('pending'), 300)),
      ]);
      expect(raced).toBe('pending');
      await lockClient.query('ROLLBACK');
    } finally {
      lockClient.release();
    }
    // After the lock releases, the previously-blocked call proceeds and creates.
    const result = await pending;
    expect(result.decision.decision).toBe('CREATED_STORY');
  });
});
