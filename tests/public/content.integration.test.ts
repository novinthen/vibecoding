import { afterAll, describe, expect, it } from 'vitest';

import { closePool, getPool, type Db } from '@/db/client';
import { PublicationRepository, PublicContentRepository } from '@/domain';
import {
  getLatest,
  getStoryPage,
  getTopicPage,
  search,
} from '@/public/content';
import { resolvePublicationConfig } from '@/public/publication';

/**
 * Public data-access integration tests (real Postgres, DATABASE_URL-gated).
 *
 * Each test runs inside a transaction that is always rolled back, so no state
 * leaks. They assert the public guarantees end-to-end against the schema:
 * Publication resolution, Article visibility, Topic filtering, search, Source
 * counts, the Entity/Tool reads, and the Story seam (empty until Stories exist).
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

async function inRollbackTx<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function topicId(tx: Db, slug: string): Promise<string> {
  const r = await tx.query<{ id: string }>(
    'SELECT id FROM topics WHERE slug = $1',
    [slug],
  );
  return r.rows[0]!.id;
}

async function createSource(
  tx: Db,
  opts: {
    slug: string;
    tier?: string;
    topicId?: string | null;
    enabled?: boolean;
  },
): Promise<string> {
  const r = await tx.query<{ id: string }>(
    `INSERT INTO sources (name, slug, source_type, authority_tier, homepage_url, default_topic_id, enabled)
     VALUES ($1, $2, 'RSS', $3, 'https://example.com', $4, $5) RETURNING id`,
    [
      `Source ${opts.slug}`,
      opts.slug,
      opts.tier ?? 'TRUSTED',
      opts.topicId ?? null,
      opts.enabled ?? true,
    ],
  );
  return r.rows[0]!.id;
}

async function createArticle(
  tx: Db,
  opts: {
    sourceId: string;
    hash: string;
    title: string;
    excerpt?: string;
    status?: string;
  },
): Promise<string> {
  const r = await tx.query<{ id: string }>(
    `INSERT INTO articles (source_id, url, url_hash, original_title, original_excerpt, status, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING id`,
    [
      opts.sourceId,
      `https://example.com/${opts.hash}`,
      opts.hash,
      opts.title,
      opts.excerpt ?? null,
      opts.status ?? 'DISCOVERED',
    ],
  );
  return r.rows[0]!.id;
}

d('public content data access', () => {
  afterAll(async () => {
    await closePool();
  });

  it('resolves an active Publication through an enabled domain', async () => {
    await inRollbackTx(async (tx) => {
      const pub = await tx.query<{ id: string }>(
        `INSERT INTO publications (name, slug) VALUES ('Global EN', 'global-en') RETURNING id`,
      );
      const pubId = pub.rows[0]!.id;
      await tx.query(
        `INSERT INTO publication_domains (publication_id, domain, is_primary, enabled)
         VALUES ($1, 'news.example.com', true, true)`,
        [pubId],
      );
      const repo = new PublicationRepository(tx);
      const row = await repo.findByDomain('news.example.com');
      expect(row?.id).toBe(pubId);
      expect(resolvePublicationConfig(row).slug).toBe('global-en');
    });
  });

  it('does not resolve a disabled domain or an unknown host', async () => {
    await inRollbackTx(async (tx) => {
      const pub = await tx.query<{ id: string }>(
        `INSERT INTO publications (name, slug) VALUES ('P', 'p') RETURNING id`,
      );
      await tx.query(
        `INSERT INTO publication_domains (publication_id, domain, enabled)
         VALUES ($1, 'disabled.example.com', false)`,
        [pub.rows[0]!.id],
      );
      const repo = new PublicationRepository(tx);
      expect(await repo.findByDomain('disabled.example.com')).toBeNull();
      expect(await repo.findByDomain('nobody.example.com')).toBeNull();
    });
  });

  it('lists only publicly-visible Articles (hides HIDDEN/DUPLICATE/FAILED)', async () => {
    await inRollbackTx(async (tx) => {
      const sourceId = await createSource(tx, { slug: 's-vis' });
      await createArticle(tx, { sourceId, hash: 'v1', title: 'Visible one' });
      await createArticle(tx, {
        sourceId,
        hash: 'v2',
        title: 'Hidden one',
        status: 'HIDDEN',
      });
      await createArticle(tx, {
        sourceId,
        hash: 'v3',
        title: 'Dup one',
        status: 'DUPLICATE',
      });
      const repo = new PublicContentRepository(tx);
      const items = await repo.listArticles({ sourceSlug: 's-vis' });
      expect(items.map((a) => a.title)).toEqual(['Visible one']);
      expect(await repo.countArticles({ sourceSlug: 's-vis' })).toBe(1);
    });
  });

  it('findArticleById returns visible items and null for hidden ones', async () => {
    await inRollbackTx(async (tx) => {
      const sourceId = await createSource(tx, { slug: 's-detail' });
      const visibleId = await createArticle(tx, {
        sourceId,
        hash: 'd1',
        title: 'Detail visible',
      });
      const hiddenId = await createArticle(tx, {
        sourceId,
        hash: 'd2',
        title: 'Detail hidden',
        status: 'FAILED',
      });
      const repo = new PublicContentRepository(tx);
      expect((await repo.findArticleById(visibleId))?.title).toBe(
        'Detail visible',
      );
      expect(await repo.findArticleById(hiddenId)).toBeNull();
    });
  });

  it('filters Articles by Topic (source default topic and enabled children)', async () => {
    await inRollbackTx(async (tx) => {
      const models = await topicId(tx, 'models');
      // A child sub-topic under Models.
      const child = await tx.query<{ id: string }>(
        `INSERT INTO topics (name, slug, parent_id, enabled) VALUES ('Frontier','frontier-models',$1,true) RETURNING id`,
        [models],
      );
      const childId = child.rows[0]!.id;
      const parentSource = await createSource(tx, {
        slug: 's-parent',
        topicId: models,
      });
      const childSource = await createSource(tx, {
        slug: 's-child',
        topicId: childId,
      });
      const otherSource = await createSource(tx, {
        slug: 's-other',
        topicId: await topicId(tx, 'business'),
      });
      await createArticle(tx, {
        sourceId: parentSource,
        hash: 't1',
        title: 'Model parent article',
      });
      await createArticle(tx, {
        sourceId: childSource,
        hash: 't2',
        title: 'Model child article',
      });
      await createArticle(tx, {
        sourceId: otherSource,
        hash: 't3',
        title: 'Business article',
      });

      const repo = new PublicContentRepository(tx);
      const ids = await repo.topicSelfAndChildIds(models);
      expect(ids).toContain(models);
      expect(ids).toContain(childId);
      const items = await repo.listArticles({ topicIds: ids });
      expect(items.map((a) => a.title).sort()).toEqual([
        'Model child article',
        'Model parent article',
      ]);

      // Composition layer resolves the slug and returns the same set.
      const page = await getTopicPage(tx, 'models', 1);
      expect(page?.items.length).toBe(2);
      expect(await getTopicPage(tx, 'no-such-topic', 1)).toBeNull();
    });
  });

  it('full-text search matches visible Articles and excludes hidden ones', async () => {
    await inRollbackTx(async (tx) => {
      const sourceId = await createSource(tx, { slug: 's-search' });
      await createArticle(tx, {
        sourceId,
        hash: 'q1',
        title: 'Anthropic ships MCP tooling',
        excerpt: 'protocol update',
      });
      await createArticle(tx, {
        sourceId,
        hash: 'q2',
        title: 'Hidden MCP note',
        status: 'HIDDEN',
      });
      const repo = new PublicContentRepository(tx);
      const hits = await repo.searchArticles('MCP');
      expect(hits.map((a) => a.title)).toEqual(['Anthropic ships MCP tooling']);
      expect(await repo.countSearch('MCP')).toBe(1);
      expect(await repo.countSearch('nonexistentword')).toBe(0);

      // Empty query short-circuits to no results without touching the DB.
      const empty = await search(tx, '   ', 1);
      expect(empty.items).toEqual([]);
      expect(empty.pagination.total).toBe(0);
    });
  });

  it('counts visible Articles per Source and orders Topic counts', async () => {
    await inRollbackTx(async (tx) => {
      const sourceId = await createSource(tx, {
        slug: 's-count',
        tier: 'PRIMARY',
        topicId: await topicId(tx, 'tools'),
      });
      await createArticle(tx, { sourceId, hash: 'c1', title: 'A' });
      await createArticle(tx, {
        sourceId,
        hash: 'c2',
        title: 'B',
        status: 'HIDDEN',
      });
      const repo = new PublicContentRepository(tx);
      const sources = await repo.listPublicSources();
      const mine = sources.find((s) => s.slug === 's-count');
      expect(mine?.articleCount).toBe(1);

      const topics = await repo.listTopLevelTopicsWithCounts();
      expect(topics.find((t) => t.slug === 'tools')?.articleCount).toBe(1);
      // All 12 controlled top-level topics are present for stable navigation.
      expect(topics.length).toBe(12);
    });
  });

  it('reads Entities and their linked Articles', async () => {
    await inRollbackTx(async (tx) => {
      const ent = await tx.query<{ id: string }>(
        `INSERT INTO entities (entity_type, name, slug) VALUES ('PRODUCT','Claude Code','claude-code') RETURNING id`,
      );
      const entityId = ent.rows[0]!.id;
      const sourceId = await createSource(tx, { slug: 's-ent' });
      const articleId = await createArticle(tx, {
        sourceId,
        hash: 'e1',
        title: 'Claude Code update',
      });
      await tx.query(
        `INSERT INTO article_entities (article_id, entity_id, relationship) VALUES ($1,$2,'SUBJECT')`,
        [articleId, entityId],
      );
      const repo = new PublicContentRepository(tx);
      expect((await repo.findEntityBySlug('claude-code'))?.name).toBe(
        'Claude Code',
      );
      const linked = await repo.listArticlesForEntity(entityId);
      expect(linked.map((a) => a.title)).toEqual(['Claude Code update']);
    });
  });

  it('paginates Latest deterministically', async () => {
    await inRollbackTx(async (tx) => {
      const sourceId = await createSource(tx, { slug: 's-page' });
      for (let i = 0; i < 3; i++) {
        await createArticle(tx, {
          sourceId,
          hash: `p${i}`,
          title: `Paged ${i}`,
        });
      }
      const page = await getLatest(tx, 1);
      expect(page.pagination.total).toBeGreaterThanOrEqual(3);
      expect(page.items.length).toBeGreaterThanOrEqual(3);
    });
  });

  it('Story seam: null for the default publication and for missing slugs', async () => {
    await inRollbackTx(async (tx) => {
      // Default (in-code) publication has no id → no Stories are resolvable.
      expect(await getStoryPage(tx, null, 'anything')).toBeNull();

      // A real publication with no published Story also resolves to null.
      const pub = await tx.query<{ id: string }>(
        `INSERT INTO publications (name, slug) VALUES ('S','s') RETURNING id`,
      );
      expect(
        await getStoryPage(tx, pub.rows[0]!.id, 'not-published'),
      ).toBeNull();
    });
  });

  it('Story seam: resolves a PUBLISHED PublicationStory with member Articles', async () => {
    await inRollbackTx(async (tx) => {
      const pub = await tx.query<{ id: string }>(
        `INSERT INTO publications (name, slug) VALUES ('S2','s2') RETURNING id`,
      );
      const pubId = pub.rows[0]!.id;
      const story = await tx.query<{ id: string }>(
        `INSERT INTO stories (slug, canonical_title, status) VALUES ('evt','Canonical Title','ACTIVE') RETURNING id`,
      );
      const storyId = story.rows[0]!.id;
      await tx.query(
        `INSERT INTO publication_stories (publication_id, story_id, status, slug, headline, published_summary, published_at)
         VALUES ($1,$2,'PUBLISHED','launch-event','Editorial Headline','A real editorial summary.', now())`,
        [pubId, storyId],
      );
      const sourceId = await createSource(tx, { slug: 's-story' });
      const articleId = await createArticle(tx, {
        sourceId,
        hash: 'sa1',
        title: 'Member coverage',
      });
      await tx.query(
        `INSERT INTO story_articles (story_id, article_id, relationship_type) VALUES ($1,$2,'PRIMARY')`,
        [storyId, articleId],
      );

      const page = await getStoryPage(tx, pubId, 'launch-event');
      expect(page?.story.title).toBe('Editorial Headline');
      expect(page?.story.summary).toBe('A real editorial summary.');
      expect(page?.articles.map((a) => a.title)).toEqual(['Member coverage']);
    });
  });
});
