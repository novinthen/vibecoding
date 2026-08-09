import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closePool, getPool, type Db } from '@/db/client';
import { migrate } from '@/db/migrate';
import { seed } from '@/db/seed';
import { validateSchema } from '@/db/validate';
import {
  ArticleRepository,
  EntityRepository,
  SourceRepository,
  StoryRepository,
  TopicRepository,
} from '@/domain';

/**
 * Real-database integration tests.
 *
 * Skipped unless DATABASE_URL is set, so unit CI (which has no database) stays
 * green while local/dev runs get full coverage. Each test body runs inside a
 * transaction that is always rolled back, so the database is left untouched.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

/** Run `fn` inside a transaction that is always rolled back. */
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

describe.skipIf(!hasDb)('database schema (integration)', () => {
  beforeAll(async () => {
    await migrate();
    await seed(getPool());
  });

  afterAll(async () => {
    await closePool();
  });

  it('reproduces the full schema from migrations', async () => {
    const result = await validateSchema(getPool());
    expect(result.missing).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('is idempotent: re-running migrate applies nothing new', async () => {
    const applied = await migrate();
    expect(applied).toEqual([]);
  });

  it('seeds exactly the twelve controlled top-level Topics', async () => {
    const topics = new TopicRepository(getPool());
    const topLevel = await topics.listTopLevel();
    expect(topLevel).toHaveLength(12);
    expect(topLevel.map((t) => t.slug)).toContain('coding-agents');
  });

  it('re-seeding inserts nothing (idempotent)', async () => {
    const result = await seed(getPool());
    expect(result.topicsInserted).toBe(0);
  });

  it('keeps Article and Story distinct and linkable many-to-one', async () => {
    await inRollbackTx(async (tx) => {
      const sources = new SourceRepository(tx);
      const articles = new ArticleRepository(tx);
      const stories = new StoryRepository(tx);

      const source = await sources.create({
        name: 'Test Source',
        slug: `test-source-${Date.now()}`,
        sourceType: 'RSS',
        authorityTier: 'PRIMARY',
      });
      const a1 = await articles.create({
        sourceId: source.id,
        url: 'https://example.com/a1',
        originalTitle: 'Announcement',
      });
      const a2 = await articles.create({
        sourceId: source.id,
        url: 'https://example.com/a2',
        originalTitle: 'Independent coverage',
      });
      const story = await stories.create({
        slug: `story-${Date.now()}`,
        canonicalTitle: 'A real-world event',
      });
      await stories.addArticle(story.id, a1.id, 'PRIMARY');
      await stories.addArticle(story.id, a2.id, 'SUPPORTING');

      const ids = await stories.listArticleIds(story.id);
      expect(new Set(ids)).toEqual(new Set([a1.id, a2.id]));
      // Article and Story are different rows in different tables.
      expect(story.id).not.toBe(a1.id);
    });
  });

  it('prevents duplicate Story–Article relationships', async () => {
    await inRollbackTx(async (tx) => {
      const sources = new SourceRepository(tx);
      const articles = new ArticleRepository(tx);
      const stories = new StoryRepository(tx);

      const source = await sources.create({
        name: 'Dup Source',
        slug: `dup-source-${Date.now()}`,
        sourceType: 'API',
        authorityTier: 'TRUSTED',
      });
      const article = await articles.create({
        sourceId: source.id,
        url: 'https://example.com/dup',
        originalTitle: 'Dup',
      });
      const story = await stories.create({
        slug: `dup-story-${Date.now()}`,
        canonicalTitle: 'Dup story',
      });
      await stories.addArticle(story.id, article.id, 'PRIMARY');
      await stories.addArticle(story.id, article.id, 'SUPPORTING');
      const ids = await stories.listArticleIds(story.id);
      expect(ids).toHaveLength(1);
    });
  });

  it('enforces per-source url_hash duplicate prevention', async () => {
    await inRollbackTx(async (tx) => {
      const sources = new SourceRepository(tx);
      const articles = new ArticleRepository(tx);
      const source = await sources.create({
        name: 'Hash Source',
        slug: `hash-source-${Date.now()}`,
        sourceType: 'RSS',
        authorityTier: 'SPECIALIST',
      });
      await articles.create({
        sourceId: source.id,
        url: 'https://example.com/x',
        originalTitle: 'X',
        urlHash: 'abc123',
      });
      await expect(
        articles.create({
          sourceId: source.id,
          url: 'https://example.com/x-again',
          originalTitle: 'X again',
          urlHash: 'abc123',
        }),
      ).rejects.toThrow();
    });
  });

  it('RESTRICTs deleting a Source that still has Articles', async () => {
    await inRollbackTx(async (tx) => {
      const sources = new SourceRepository(tx);
      const articles = new ArticleRepository(tx);
      const source = await sources.create({
        name: 'Restrict Source',
        slug: `restrict-source-${Date.now()}`,
        sourceType: 'RSS',
        authorityTier: 'PRIMARY',
      });
      await articles.create({
        sourceId: source.id,
        url: 'https://example.com/keep',
        originalTitle: 'Keep me',
      });
      await expect(
        tx.query('DELETE FROM sources WHERE id = $1', [source.id]),
      ).rejects.toThrow();
    });
  });

  it('resolves entity aliases to one canonical Entity', async () => {
    await inRollbackTx(async (tx) => {
      const entities = new EntityRepository(tx);
      const entity = await entities.create({
        entityType: 'PRODUCT',
        name: 'Claude Code',
        slug: `claude-code-${Date.now()}`,
      });
      await entities.addAlias(entity.id, 'Claude CLI', 'claude-cli');
      const resolved = await entities.findByNormalizedAlias('claude-cli');
      expect(resolved?.id).toBe(entity.id);
    });
  });

  it('publishes one Story to multiple Publications without duplicating facts', async () => {
    await inRollbackTx(async (tx) => {
      const stories = new StoryRepository(tx);
      const story = await stories.create({
        slug: `multi-pub-${Date.now()}`,
        canonicalTitle: 'Shared canonical story',
      });

      const pubA = await tx.query<{ id: string }>(
        `INSERT INTO publications (name, slug) VALUES ($1, $2) RETURNING id`,
        ['Global EN', `global-en-${Date.now()}`],
      );
      const pubB = await tx.query<{ id: string }>(
        `INSERT INTO publications (name, slug) VALUES ($1, $2) RETURNING id`,
        ['Business EN', `business-en-${Date.now()}`],
      );

      await tx.query(
        `INSERT INTO publication_stories (publication_id, story_id, headline)
         VALUES ($1, $3, 'A'), ($2, $3, 'B')`,
        [pubA.rows[0]?.id, pubB.rows[0]?.id, story.id],
      );

      const count = await tx.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM publication_stories WHERE story_id = $1',
        [story.id],
      );
      expect(count.rows[0]?.n).toBe('2');
    });
  });

  describe('StoryLocalization belongs to PublicationStory', () => {
    /**
     * Create a Story, a Publication, and the PublicationStory that publishes the
     * former under the latter. Returns the ids needed to attach localisations.
     */
    async function publishStory(
      tx: Db,
      tag: string,
    ): Promise<{
      storyId: string;
      publicationId: string;
      publicationStoryId: string;
    }> {
      const suffix = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const story = await tx.query<{ id: string }>(
        `INSERT INTO stories (slug, canonical_title)
         VALUES ($1, $2) RETURNING id`,
        [`story-${suffix}`, 'Canonical story'],
      );
      const pub = await tx.query<{ id: string }>(
        `INSERT INTO publications (name, slug) VALUES ($1, $2) RETURNING id`,
        [`Pub ${suffix}`, `pub-${suffix}`],
      );
      const storyId = story.rows[0]!.id;
      const publicationId = pub.rows[0]!.id;
      const ps = await tx.query<{ id: string }>(
        `INSERT INTO publication_stories (publication_id, story_id, headline)
         VALUES ($1, $2, $3) RETURNING id`,
        [publicationId, storyId, 'Headline'],
      );
      return { storyId, publicationId, publicationStoryId: ps.rows[0]!.id };
    }

    async function addLocalization(
      tx: Db,
      publicationStoryId: string,
      locale: string,
    ): Promise<void> {
      await tx.query(
        `INSERT INTO story_localizations (publication_story_id, locale, headline)
         VALUES ($1, $2, $3)`,
        [publicationStoryId, locale, `Headline ${locale}`],
      );
    }

    it('rejects a localisation with no PublicationStory parent', async () => {
      await inRollbackTx(async (tx) => {
        // A random (non-existent) parent id violates the foreign key.
        await expect(
          tx.query(
            `INSERT INTO story_localizations (publication_story_id, locale)
             VALUES (gen_random_uuid(), 'en')`,
          ),
        ).rejects.toThrow();
      });
    });

    it('allows multiple locales under one PublicationStory', async () => {
      await inRollbackTx(async (tx) => {
        const { publicationStoryId } = await publishStory(tx, 'multi-locale');
        await addLocalization(tx, publicationStoryId, 'en');
        await addLocalization(tx, publicationStoryId, 'ms');
        const count = await tx.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM story_localizations
           WHERE publication_story_id = $1`,
          [publicationStoryId],
        );
        expect(count.rows[0]?.n).toBe('2');
      });
    });

    it('rejects a duplicate locale for one PublicationStory', async () => {
      await inRollbackTx(async (tx) => {
        const { publicationStoryId } = await publishStory(tx, 'dup-locale');
        await addLocalization(tx, publicationStoryId, 'en');
        await expect(
          addLocalization(tx, publicationStoryId, 'en'),
        ).rejects.toThrow();
      });
    });

    it('cascades: deleting a PublicationStory removes its localisations', async () => {
      await inRollbackTx(async (tx) => {
        const { publicationStoryId } = await publishStory(tx, 'cascade');
        await addLocalization(tx, publicationStoryId, 'en');
        await addLocalization(tx, publicationStoryId, 'ms');
        await tx.query('DELETE FROM publication_stories WHERE id = $1', [
          publicationStoryId,
        ]);
        const count = await tx.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM story_localizations
           WHERE publication_story_id = $1`,
          [publicationStoryId],
        );
        expect(count.rows[0]?.n).toBe('0');
      });
    });

    it('lets multiple Publications independently publish and localise one Story', async () => {
      await inRollbackTx(async (tx) => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const story = await tx.query<{ id: string }>(
          `INSERT INTO stories (slug, canonical_title)
           VALUES ($1, $2) RETURNING id`,
          [`shared-${suffix}`, 'Shared canonical story'],
        );
        const storyId = story.rows[0]!.id;

        const mkPubStory = async (name: string): Promise<string> => {
          const pub = await tx.query<{ id: string }>(
            `INSERT INTO publications (name, slug) VALUES ($1, $2) RETURNING id`,
            [name, `${name}-${suffix}`.toLowerCase().replace(/\s+/g, '-')],
          );
          const ps = await tx.query<{ id: string }>(
            `INSERT INTO publication_stories (publication_id, story_id, headline)
             VALUES ($1, $2, $3) RETURNING id`,
            [pub.rows[0]!.id, storyId, name],
          );
          return ps.rows[0]!.id;
        };

        const psA = await mkPubStory('Global EN');
        const psB = await mkPubStory('Bahasa MY');
        // Both publish the SAME canonical Story, each with its own localisation.
        await addLocalization(tx, psA, 'en');
        await addLocalization(tx, psB, 'ms');

        // Deleting one Publication's PublicationStory must not affect the other.
        await tx.query('DELETE FROM publication_stories WHERE id = $1', [psA]);

        const remaining = await tx.query<{ publication_story_id: string }>(
          `SELECT l.publication_story_id
           FROM story_localizations l
           JOIN publication_stories ps ON ps.id = l.publication_story_id
           WHERE ps.story_id = $1`,
          [storyId],
        );
        expect(remaining.rows.map((r) => r.publication_story_id)).toEqual([
          psB,
        ]);
      });
    });
  });
});
