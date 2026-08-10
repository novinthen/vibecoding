import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closePool, getPool, type Db } from '@/db/client';
import { migrate } from '@/db/migrate';
import { getStoryPage } from '@/public/content';

/**
 * Stage 5B public localisation integration tests (real Postgres, gated).
 *
 * Exercise the documented public locale-resolution + fallback policy end-to-end
 * through `getStoryPage`, and prove localisation content never leaks across
 * Publications. Each body runs inside an always-rolled-back transaction.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

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

async function publication(
  tx: Db,
  slug: string,
  locale = 'en',
): Promise<string> {
  const r = await tx.query<{ id: string }>(
    `INSERT INTO publications (name, slug, default_locale) VALUES ($1,$2,$3) RETURNING id`,
    [`Pub ${slug}`, slug, locale],
  );
  return r.rows[0]!.id;
}

async function story(tx: Db, slug: string): Promise<string> {
  const r = await tx.query<{ id: string }>(
    `INSERT INTO stories (slug, canonical_title, summary, status)
     VALUES ($1,$2,'Canonical summary','ACTIVE') RETURNING id`,
    [slug, `Canonical ${slug}`],
  );
  return r.rows[0]!.id;
}

async function publish(
  tx: Db,
  pubId: string,
  storyId: string,
  slug: string,
  headline: string,
): Promise<string> {
  const r = await tx.query<{ id: string }>(
    `INSERT INTO publication_stories
       (publication_id, story_id, status, slug, headline, published_summary, published_at)
     VALUES ($1,$2,'PUBLISHED',$3,$4,'Default publication summary', now())
     RETURNING id`,
    [pubId, storyId, slug, headline],
  );
  return r.rows[0]!.id;
}

async function localize(
  tx: Db,
  psId: string,
  locale: string,
  headline: string,
  status = 'PUBLISHED',
): Promise<void> {
  await tx.query(
    `INSERT INTO story_localizations
       (publication_story_id, locale, headline, summary, status, translation_source)
     VALUES ($1,$2,$3,$4,$5,'HUMAN')`,
    [psId, locale, headline, `${headline} summary`, status],
  );
}

describe.skipIf(!hasDb)('Stage 5B public localisation (integration)', () => {
  beforeAll(async () => {
    await migrate();
  });
  afterAll(async () => {
    await closePool();
  });

  it('falls back to the publication default copy when no localisation exists', async () => {
    await inRollbackTx(async (tx) => {
      const pub = await publication(tx, 'fb', 'en');
      const st = await story(tx, 'fb-s');
      await publish(tx, pub, st, 'launch', 'Default Headline');

      const page = await getStoryPage(tx, pub, 'en', 'launch');
      expect(page?.story.title).toBe('Default Headline');
      expect(page?.resolvedLocale).toBe('en');
      expect(page?.localized).toBe(false);
      expect(page?.availableLocales).toEqual([]);
    });
  });

  it('serves an approved localisation for the requested locale', async () => {
    await inRollbackTx(async (tx) => {
      const pub = await publication(tx, 'ms-pub', 'en');
      const st = await story(tx, 'ms-s');
      const ps = await publish(tx, pub, st, 'launch', 'Default Headline');
      await localize(tx, ps, 'ms', 'Tajuk Melayu');

      const page = await getStoryPage(tx, pub, 'en', 'launch', 'ms');
      expect(page?.story.title).toBe('Tajuk Melayu');
      expect(page?.resolvedLocale).toBe('ms');
      expect(page?.localized).toBe(true);
      expect(page?.availableLocales).toEqual(['ms']);
    });
  });

  it('falls back to the default-locale localisation when the requested one is missing', async () => {
    await inRollbackTx(async (tx) => {
      const pub = await publication(tx, 'def-loc', 'en');
      const st = await story(tx, 'def-loc-s');
      const ps = await publish(tx, pub, st, 'launch', 'Default Headline');
      // Only an English localisation is published; request Malay.
      await localize(tx, ps, 'en', 'English Localised Headline');

      const page = await getStoryPage(tx, pub, 'en', 'launch', 'ms');
      expect(page?.resolvedLocale).toBe('en');
      expect(page?.story.title).toBe('English Localised Headline');
      expect(page?.localized).toBe(true);
    });
  });

  it('ignores an ill-formed requested locale (never trusted)', async () => {
    await inRollbackTx(async (tx) => {
      const pub = await publication(tx, 'junk', 'en');
      const st = await story(tx, 'junk-s');
      await publish(tx, pub, st, 'launch', 'Default Headline');

      const page = await getStoryPage(tx, pub, 'en', 'launch', 'not a locale');
      expect(page?.resolvedLocale).toBe('en');
      expect(page?.story.title).toBe('Default Headline');
    });
  });

  it('does not serve DRAFT/REVIEW localisations publicly', async () => {
    await inRollbackTx(async (tx) => {
      const pub = await publication(tx, 'draftloc', 'en');
      const st = await story(tx, 'draftloc-s');
      const ps = await publish(tx, pub, st, 'launch', 'Default Headline');
      await localize(tx, ps, 'ms', 'Draft Malay', 'DRAFT');
      await localize(tx, ps, 'fr', 'Review French', 'REVIEW');

      const page = await getStoryPage(tx, pub, 'en', 'launch', 'ms');
      // Requested Malay is only DRAFT → falls back to default publication copy.
      expect(page?.localized).toBe(false);
      expect(page?.story.title).toBe('Default Headline');
      // Only PUBLISHED locales are advertised.
      expect(page?.availableLocales).toEqual([]);
    });
  });

  it('never leaks localisation content across Publications', async () => {
    await inRollbackTx(async (tx) => {
      const st = await story(tx, 'shared');
      const pubA = await publication(tx, 'leak-a', 'en');
      const pubB = await publication(tx, 'leak-b', 'en');
      const psA = await publish(tx, pubA, st, 'same-slug', 'A Headline');
      await publish(tx, pubB, st, 'same-slug', 'B Headline');
      // Only Publication A has a Malay localisation.
      await localize(tx, psA, 'ms', 'A Malay Only');

      // Publication A serves its Malay localisation.
      const a = await getStoryPage(tx, pubA, 'en', 'same-slug', 'ms');
      expect(a?.story.title).toBe('A Malay Only');

      // Publication B, requesting Malay, must NOT see A's content — it falls
      // back to B's own default publication copy.
      const b = await getStoryPage(tx, pubB, 'en', 'same-slug', 'ms');
      expect(b?.localized).toBe(false);
      expect(b?.story.title).toBe('B Headline');
      expect(b?.availableLocales).toEqual([]);
    });
  });

  it('only resolves PUBLISHED PublicationStories', async () => {
    await inRollbackTx(async (tx) => {
      const pub = await publication(tx, 'draftps', 'en');
      const st = await story(tx, 'draftps-s');
      await tx.query(
        `INSERT INTO publication_stories (publication_id, story_id, status, slug, headline)
         VALUES ($1,$2,'DRAFT','hidden','Draft Headline')`,
        [pub, st],
      );
      expect(await getStoryPage(tx, pub, 'en', 'hidden')).toBeNull();
    });
  });
});
