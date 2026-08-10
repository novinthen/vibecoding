import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UnauthorizedError } from '@/admin/auth/guard';
import type { AdminSession } from '@/admin/auth/session';
import { AdminValidationError, NotFoundError } from '@/admin/errors';
import {
  addPublicationDomain,
  createPublication,
  removePublicationDomain,
  setPrimaryPublicationDomain,
  setPublicationDomainEnabled,
  setPublicationStatus,
  updatePublication,
} from '@/admin/services/publication-service';
import {
  createPublicationStory,
  setPublicationStoryStatus,
  updatePublicationStory,
} from '@/admin/services/publication-story-service';
import {
  createStoryLocalization,
  setStoryLocalizationStatus,
} from '@/admin/services/story-localization-service';
import { closePool, getPool, type Db } from '@/db/client';
import { migrate } from '@/db/migrate';
import {
  AdminAuditLogRepository,
  PublicationRepository,
  StoryRepository,
} from '@/domain';

/**
 * Stage 5B admin service integration tests (real Postgres, DATABASE_URL-gated).
 *
 * Each body runs inside a transaction that is always rolled back. They assert
 * the multi-publication invariants end-to-end: authorization, unique domains,
 * the primary-domain invariant, PublicationStory separation from canonical
 * facts, StoryLocalization parentage / one-locale-per-PublicationStory /
 * multi-locale, the same Story independently localised by different
 * Publications, no cross-Publication leakage, and audit logging for every
 * mutation.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

const ADMIN: AdminSession = {
  username: 'alice',
  role: 'ADMIN',
  iat: 0,
  exp: 9e9,
};
const VIEWER: AdminSession = {
  username: 'val',
  role: 'VIEWER',
  iat: 0,
  exp: 9e9,
};

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

function auditCount(tx: Db, action: string): Promise<number> {
  return tx
    .query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM admin_audit_log WHERE action = $1',
      [action],
    )
    .then((r) => Number(r.rows[0]?.count ?? '0'));
}

const basePub = {
  name: 'Global EN',
  defaultLocale: 'en',
  timezone: 'UTC',
};

async function seedStory(tx: Db, slug: string): Promise<string> {
  const r = await tx.query<{ id: string }>(
    `INSERT INTO stories (slug, canonical_title, summary, why_it_matters, status)
     VALUES ($1, $2, 'Canonical summary', 'Canonical why', 'ACTIVE') RETURNING id`,
    [slug, `Canonical ${slug}`],
  );
  return r.rows[0]!.id;
}

describe.skipIf(!hasDb)('Stage 5B publication admin (integration)', () => {
  beforeAll(async () => {
    await migrate();
  });
  afterAll(async () => {
    await closePool();
  });

  describe('publication CRUD + authorization + audit', () => {
    it('creates a Publication and writes a PUBLICATION_CREATE audit record', async () => {
      await inRollbackTx(async (tx) => {
        const created = await createPublication(tx, ADMIN, {
          ...basePub,
          slug: 'global-en',
          brandingName: 'Global',
          seoDescription: 'Global desc',
        });
        expect(created.slug).toBe('global-en');
        expect(created.branding).toMatchObject({ name: 'Global' });
        expect(created.seo_settings).toMatchObject({
          description: 'Global desc',
        });

        const audit = await new AdminAuditLogRepository(tx).listRecent({
          targetType: 'publication',
          targetId: created.id,
        });
        expect(audit[0]?.action).toBe('PUBLICATION_CREATE');
        expect(audit[0]?.actor_identifier).toBe('alice');
      });
    });

    it('rejects a VIEWER create with no write and no audit', async () => {
      await inRollbackTx(async (tx) => {
        await expect(
          createPublication(tx, VIEWER, { ...basePub, slug: 'denied' }),
        ).rejects.toBeInstanceOf(UnauthorizedError);
        expect(await auditCount(tx, 'PUBLICATION_CREATE')).toBe(0);
      });
    });

    it('rejects an invalid locale and a duplicate slug', async () => {
      await inRollbackTx(async (tx) => {
        await expect(
          createPublication(tx, ADMIN, {
            ...basePub,
            slug: 'bad-locale',
            defaultLocale: 'not-a-locale',
          }),
        ).rejects.toBeTruthy();

        await createPublication(tx, ADMIN, { ...basePub, slug: 'dup' });
        await expect(
          createPublication(tx, ADMIN, { ...basePub, slug: 'dup' }),
        ).rejects.toBeInstanceOf(AdminValidationError);
      });
    });

    it('merges branding/SEO on update and preserves unknown JSONB keys', async () => {
      await inRollbackTx(async (tx) => {
        const created = await createPublication(tx, ADMIN, {
          ...basePub,
          slug: 'merge-me',
        });
        // Simulate a pre-existing, out-of-band branding key.
        await tx.query(
          `UPDATE publications SET branding = '{"themeColor":"#123"}'::jsonb WHERE id = $1`,
          [created.id],
        );

        const updated = await updatePublication(tx, ADMIN, created.id, {
          ...basePub,
          name: 'Renamed',
          brandingName: 'BrandName',
          tagline: '',
        });
        expect(updated.name).toBe('Renamed');
        // Known key set, unknown key preserved, blank tagline not added.
        expect(updated.branding).toMatchObject({
          themeColor: '#123',
          name: 'BrandName',
        });
        expect('tagline' in updated.branding).toBe(false);
      });
    });

    it('changes status and audits from/to', async () => {
      await inRollbackTx(async (tx) => {
        const created = await createPublication(tx, ADMIN, {
          ...basePub,
          slug: 'status-me',
        });
        const updated = await setPublicationStatus(tx, ADMIN, created.id, {
          status: 'INACTIVE',
        });
        expect(updated.status).toBe('INACTIVE');
        expect(await auditCount(tx, 'PUBLICATION_STATUS_CHANGE')).toBe(1);
      });
    });
  });

  describe('domains: uniqueness, primary invariant, lifecycle', () => {
    it('enforces global domain uniqueness across publications', async () => {
      await inRollbackTx(async (tx) => {
        const a = await createPublication(tx, ADMIN, { ...basePub, slug: 'a' });
        const b = await createPublication(tx, ADMIN, { ...basePub, slug: 'b' });
        await addPublicationDomain(tx, ADMIN, a.id, {
          domain: 'news.example.com',
        });
        await expect(
          addPublicationDomain(tx, ADMIN, b.id, {
            domain: 'news.example.com',
          }),
        ).rejects.toBeInstanceOf(AdminValidationError);
      });
    });

    it('keeps at most one primary domain per publication', async () => {
      await inRollbackTx(async (tx) => {
        const p = await createPublication(tx, ADMIN, { ...basePub, slug: 'p' });
        const d1 = await addPublicationDomain(tx, ADMIN, p.id, {
          domain: 'one.example.com',
          isPrimary: true,
        });
        const d2 = await addPublicationDomain(tx, ADMIN, p.id, {
          domain: 'two.example.com',
        });
        // Promote the second; the first must lose primary (partial unique index).
        await setPrimaryPublicationDomain(tx, ADMIN, p.id, d2.id);

        const primaries = await tx.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM publication_domains
           WHERE publication_id = $1 AND is_primary = true`,
          [p.id],
        );
        expect(Number(primaries.rows[0]!.count)).toBe(1);
        const rows = await new (await import('@/domain')).PublicationRepository(
          tx,
        ).listDomains(p.id);
        expect(rows.find((d) => d.id === d2.id)?.is_primary).toBe(true);
        expect(rows.find((d) => d.id === d1.id)?.is_primary).toBe(false);
      });
    });

    it('rejects operating on a domain that belongs to another publication', async () => {
      await inRollbackTx(async (tx) => {
        const a = await createPublication(tx, ADMIN, {
          ...basePub,
          slug: 'aa',
        });
        const b = await createPublication(tx, ADMIN, {
          ...basePub,
          slug: 'bb',
        });
        const d = await addPublicationDomain(tx, ADMIN, a.id, {
          domain: 'a-only.example.com',
        });
        await expect(
          setPublicationDomainEnabled(tx, ADMIN, b.id, d.id, false),
        ).rejects.toBeInstanceOf(NotFoundError);
      });
    });

    it('disables, re-enables, removes, and audits domains; VIEWER denied', async () => {
      await inRollbackTx(async (tx) => {
        const p = await createPublication(tx, ADMIN, {
          ...basePub,
          slug: 'pd',
        });
        const d = await addPublicationDomain(tx, ADMIN, p.id, {
          domain: 'lifecycle.example.com',
        });
        await expect(
          setPublicationDomainEnabled(tx, VIEWER, p.id, d.id, false),
        ).rejects.toBeInstanceOf(UnauthorizedError);

        expect(
          (await setPublicationDomainEnabled(tx, ADMIN, p.id, d.id, false))
            .enabled,
        ).toBe(false);
        await removePublicationDomain(tx, ADMIN, p.id, d.id);
        expect(await auditCount(tx, 'PUBLICATION_DOMAIN_ADD')).toBe(1);
        expect(await auditCount(tx, 'PUBLICATION_DOMAIN_DISABLE')).toBe(1);
        expect(await auditCount(tx, 'PUBLICATION_DOMAIN_REMOVE')).toBe(1);
      });
    });
  });

  describe('domain primary invariant lifecycle', () => {
    async function domains(tx: Db, pubId: string) {
      return new PublicationRepository(tx).listDomains(pubId);
    }

    it('makes the first domain primary automatically even without the checkbox', async () => {
      await inRollbackTx(async (tx) => {
        const p = await createPublication(tx, ADMIN, {
          ...basePub,
          slug: 'fp',
        });
        const d = await addPublicationDomain(tx, ADMIN, p.id, {
          domain: 'first.example.com',
          // isPrimary omitted → still becomes primary because it is the first.
        });
        expect(d.is_primary).toBe(true);
        expect(d.enabled).toBe(true);
      });
    });

    it('does not make a second domain primary unless explicitly selected', async () => {
      await inRollbackTx(async (tx) => {
        const p = await createPublication(tx, ADMIN, {
          ...basePub,
          slug: 'sp',
        });
        const d1 = await addPublicationDomain(tx, ADMIN, p.id, {
          domain: 'one.example.com',
        });
        const d2 = await addPublicationDomain(tx, ADMIN, p.id, {
          domain: 'two.example.com',
        });
        expect(d2.is_primary).toBe(false);
        const rows = await domains(tx, p.id);
        expect(rows.find((d) => d.id === d1.id)?.is_primary).toBe(true);
      });
    });

    it('adding a domain marked primary atomically replaces the previous primary', async () => {
      await inRollbackTx(async (tx) => {
        const p = await createPublication(tx, ADMIN, {
          ...basePub,
          slug: 'ap',
        });
        const d1 = await addPublicationDomain(tx, ADMIN, p.id, {
          domain: 'one.example.com',
        });
        const d2 = await addPublicationDomain(tx, ADMIN, p.id, {
          domain: 'two.example.com',
          isPrimary: true,
        });
        const rows = await domains(tx, p.id);
        expect(rows.find((d) => d.id === d2.id)?.is_primary).toBe(true);
        expect(rows.find((d) => d.id === d1.id)?.is_primary).toBe(false);
        expect(rows.filter((d) => d.is_primary)).toHaveLength(1);
      });
    });

    it('refuses to make a disabled domain primary', async () => {
      await inRollbackTx(async (tx) => {
        const p = await createPublication(tx, ADMIN, {
          ...basePub,
          slug: 'dp',
        });
        await addPublicationDomain(tx, ADMIN, p.id, {
          domain: 'primary.example.com',
        });
        const d2 = await addPublicationDomain(tx, ADMIN, p.id, {
          domain: 'second.example.com',
        });
        await setPublicationDomainEnabled(tx, ADMIN, p.id, d2.id, false);
        await expect(
          setPrimaryPublicationDomain(tx, ADMIN, p.id, d2.id),
        ).rejects.toBeInstanceOf(AdminValidationError);
      });
    });

    it('auto-promotes a deterministic replacement when the primary is disabled', async () => {
      await inRollbackTx(async (tx) => {
        const p = await createPublication(tx, ADMIN, {
          ...basePub,
          slug: 'pr',
        });
        const primary = await addPublicationDomain(tx, ADMIN, p.id, {
          domain: 'primary.example.com',
        });
        const spare = await addPublicationDomain(tx, ADMIN, p.id, {
          domain: 'spare.example.com',
        });
        await setPublicationStatus(tx, ADMIN, p.id, { status: 'ACTIVE' });

        const disabled = await setPublicationDomainEnabled(
          tx,
          ADMIN,
          p.id,
          primary.id,
          false,
        );
        expect(disabled.is_primary).toBe(false);
        expect(disabled.enabled).toBe(false);
        const rows = await domains(tx, p.id);
        expect(rows.find((d) => d.id === spare.id)?.is_primary).toBe(true);
        expect(rows.filter((d) => d.is_primary && d.enabled)).toHaveLength(1);
        // The auto-promotion is audited.
        expect(await auditCount(tx, 'PUBLICATION_DOMAIN_SET_PRIMARY')).toBe(1);
      });
    });

    it('refuses to disable the only enabled primary of an ACTIVE publication', async () => {
      await inRollbackTx(async (tx) => {
        const p = await createPublication(tx, ADMIN, {
          ...basePub,
          slug: 'op',
        });
        const only = await addPublicationDomain(tx, ADMIN, p.id, {
          domain: 'only.example.com',
        });
        await setPublicationStatus(tx, ADMIN, p.id, { status: 'ACTIVE' });
        await expect(
          setPublicationDomainEnabled(tx, ADMIN, p.id, only.id, false),
        ).rejects.toBeInstanceOf(AdminValidationError);
        // Nothing changed: still enabled + primary.
        const rows = await domains(tx, p.id);
        expect(rows[0]?.enabled).toBe(true);
        expect(rows[0]?.is_primary).toBe(true);
      });
    });

    it('auto-promotes a replacement when the primary is removed', async () => {
      await inRollbackTx(async (tx) => {
        const p = await createPublication(tx, ADMIN, {
          ...basePub,
          slug: 'rm',
        });
        const primary = await addPublicationDomain(tx, ADMIN, p.id, {
          domain: 'primary.example.com',
        });
        const spare = await addPublicationDomain(tx, ADMIN, p.id, {
          domain: 'spare.example.com',
        });
        await setPublicationStatus(tx, ADMIN, p.id, { status: 'ACTIVE' });
        await removePublicationDomain(tx, ADMIN, p.id, primary.id);
        const rows = await domains(tx, p.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.id).toBe(spare.id);
        expect(rows[0]?.is_primary).toBe(true);
      });
    });

    it('refuses to remove the only enabled primary of an ACTIVE publication', async () => {
      await inRollbackTx(async (tx) => {
        const p = await createPublication(tx, ADMIN, {
          ...basePub,
          slug: 'ro',
        });
        const only = await addPublicationDomain(tx, ADMIN, p.id, {
          domain: 'only.example.com',
        });
        await setPublicationStatus(tx, ADMIN, p.id, { status: 'ACTIVE' });
        await expect(
          removePublicationDomain(tx, ADMIN, p.id, only.id),
        ).rejects.toBeInstanceOf(AdminValidationError);
      });
    });

    it('cannot activate a publication with no enabled primary domain', async () => {
      await inRollbackTx(async (tx) => {
        const p = await createPublication(tx, ADMIN, {
          ...basePub,
          slug: 'na',
        });
        // New publications start INACTIVE and have no domains.
        expect(p.status).toBe('INACTIVE');
        await expect(
          setPublicationStatus(tx, ADMIN, p.id, { status: 'ACTIVE' }),
        ).rejects.toBeInstanceOf(AdminValidationError);

        // Add a domain (auto-primary, enabled) → activation now succeeds.
        await addPublicationDomain(tx, ADMIN, p.id, {
          domain: 'ready.example.com',
        });
        const active = await setPublicationStatus(tx, ADMIN, p.id, {
          status: 'ACTIVE',
        });
        expect(active.status).toBe('ACTIVE');
      });
    });

    it('re-enabling a domain restores a primary when the publication has none', async () => {
      await inRollbackTx(async (tx) => {
        const p = await createPublication(tx, ADMIN, {
          ...basePub,
          slug: 're',
        });
        const d = await addPublicationDomain(tx, ADMIN, p.id, {
          domain: 'solo.example.com',
        });
        // Publication is INACTIVE, so disabling the sole primary is allowed and
        // leaves it with no primary.
        await setPublicationDomainEnabled(tx, ADMIN, p.id, d.id, false);
        let rows = await domains(tx, p.id);
        expect(rows[0]?.is_primary).toBe(false);
        // Re-enabling promotes it back to primary (no other primary exists).
        const reEnabled = await setPublicationDomainEnabled(
          tx,
          ADMIN,
          p.id,
          d.id,
          true,
        );
        expect(reEnabled.enabled).toBe(true);
        expect(reEnabled.is_primary).toBe(true);
        rows = await domains(tx, p.id);
        expect(rows.filter((x) => x.is_primary)).toHaveLength(1);
      });
    });

    it('keeps two publications completely independent', async () => {
      await inRollbackTx(async (tx) => {
        const a = await createPublication(tx, ADMIN, {
          ...basePub,
          slug: 'i-a',
        });
        const b = await createPublication(tx, ADMIN, {
          ...basePub,
          slug: 'i-b',
        });
        const aPrimary = await addPublicationDomain(tx, ADMIN, a.id, {
          domain: 'a1.example.com',
        });
        await addPublicationDomain(tx, ADMIN, a.id, {
          domain: 'a2.example.com',
        });
        const bPrimary = await addPublicationDomain(tx, ADMIN, b.id, {
          domain: 'b1.example.com',
        });
        await setPublicationStatus(tx, ADMIN, a.id, { status: 'ACTIVE' });
        await setPublicationStatus(tx, ADMIN, b.id, { status: 'ACTIVE' });

        // Disabling A's primary promotes A's spare and never touches B.
        await setPublicationDomainEnabled(tx, ADMIN, a.id, aPrimary.id, false);
        const bRows = await domains(tx, b.id);
        expect(bRows).toHaveLength(1);
        expect(bRows[0]?.id).toBe(bPrimary.id);
        expect(bRows[0]?.is_primary).toBe(true);
        expect(bRows[0]?.enabled).toBe(true);
        // B still has exactly one enabled primary; B remains ACTIVE-valid.
        expect(
          await new PublicationRepository(tx).findEnabledPrimaryDomain(b.id),
        ).not.toBeNull();
      });
    });
  });

  describe('publication stories: canonical separation + workflow', () => {
    it('attaches a real Story without altering canonical facts, and audits', async () => {
      await inRollbackTx(async (tx) => {
        const p = await createPublication(tx, ADMIN, {
          ...basePub,
          slug: 'ps1',
        });
        const storyId = await seedStory(tx, 'evt-1');

        const ps = await createPublicationStory(tx, ADMIN, p.id, {
          storyId,
          slug: 'launch',
          headline: 'Editorial Headline',
          publishedSummary: 'Editorial summary',
        });
        expect(ps.headline).toBe('Editorial Headline');

        // Canonical Story row is untouched by presentation edits.
        await updatePublicationStory(tx, ADMIN, ps.id, {
          slug: 'launch',
          headline: 'Changed Headline',
          publishedSummary: 'Changed summary',
        });
        const canonical = await new StoryRepository(tx).findById(storyId);
        expect(canonical?.canonical_title).toBe('Canonical evt-1');
        expect(canonical?.summary).toBe('Canonical summary');

        expect(await auditCount(tx, 'PUBLICATION_STORY_CREATE')).toBe(1);
        expect(await auditCount(tx, 'PUBLICATION_STORY_UPDATE')).toBe(1);
      });
    });

    it('prevents attaching the same Story twice and duplicate slugs', async () => {
      await inRollbackTx(async (tx) => {
        const p = await createPublication(tx, ADMIN, {
          ...basePub,
          slug: 'ps2',
        });
        const storyId = await seedStory(tx, 'evt-2');
        const other = await seedStory(tx, 'evt-2b');
        await createPublicationStory(tx, ADMIN, p.id, {
          storyId,
          slug: 'dup-slug',
        });
        await expect(
          createPublicationStory(tx, ADMIN, p.id, { storyId, slug: 'x' }),
        ).rejects.toBeInstanceOf(AdminValidationError);
        await expect(
          createPublicationStory(tx, ADMIN, p.id, {
            storyId: other,
            slug: 'dup-slug',
          }),
        ).rejects.toBeInstanceOf(AdminValidationError);
      });
    });

    it('publishing requires a slug and stamps published_at once', async () => {
      await inRollbackTx(async (tx) => {
        const p = await createPublication(tx, ADMIN, {
          ...basePub,
          slug: 'ps3',
        });
        const storyId = await seedStory(tx, 'evt-3');
        const ps = await createPublicationStory(tx, ADMIN, p.id, {
          storyId,
          slug: 'go-live',
        });
        const published = await setPublicationStoryStatus(tx, ADMIN, ps.id, {
          status: 'PUBLISHED',
        });
        expect(published.status).toBe('PUBLISHED');
        expect(published.published_at).not.toBeNull();
        const firstStamp = String(published.published_at);
        // Re-publishing keeps the original timestamp.
        const again = await setPublicationStoryStatus(tx, ADMIN, ps.id, {
          status: 'PUBLISHED',
        });
        expect(String(again.published_at)).toBe(firstStamp);
      });
    });

    it('lets two Publications publish the same Story with different headlines', async () => {
      await inRollbackTx(async (tx) => {
        const a = await createPublication(tx, ADMIN, {
          ...basePub,
          slug: 'en-a',
        });
        const b = await createPublication(tx, ADMIN, {
          ...basePub,
          slug: 'en-b',
          name: 'EN B',
        });
        const storyId = await seedStory(tx, 'shared-evt');
        const psA = await createPublicationStory(tx, ADMIN, a.id, {
          storyId,
          slug: 'same',
          headline: 'A angle',
        });
        const psB = await createPublicationStory(tx, ADMIN, b.id, {
          storyId,
          slug: 'same',
          headline: 'B angle',
        });
        // Same slug across DIFFERENT publications is allowed; headlines differ.
        expect(psA.headline).toBe('A angle');
        expect(psB.headline).toBe('B angle');
        expect(psA.id).not.toBe(psB.id);
      });
    });
  });

  describe('story localizations: parentage, uniqueness, review, isolation', () => {
    async function attach(tx: Db, slug: string) {
      const p = await createPublication(tx, ADMIN, { ...basePub, slug });
      const storyId = await seedStory(tx, `${slug}-s`);
      const ps = await createPublicationStory(tx, ADMIN, p.id, {
        storyId,
        slug: 'story',
        headline: 'EN headline',
      });
      return { publicationId: p.id, ps };
    }

    it('creates multiple locales under one PublicationStory but rejects a duplicate locale', async () => {
      await inRollbackTx(async (tx) => {
        const { ps } = await attach(tx, 'loc1');
        await createStoryLocalization(tx, ADMIN, ps.id, {
          locale: 'ms',
          headline: 'Tajuk',
        });
        await createStoryLocalization(tx, ADMIN, ps.id, {
          locale: 'zh-Hans',
          headline: '标题',
        });
        // One locale per PublicationStory.
        await expect(
          createStoryLocalization(tx, ADMIN, ps.id, {
            locale: 'MS',
            headline: 'again',
          }),
        ).rejects.toBeInstanceOf(AdminValidationError);
        expect(await auditCount(tx, 'STORY_LOCALIZATION_CREATE')).toBe(2);
      });
    });

    it('requires an existing PublicationStory parent', async () => {
      await inRollbackTx(async (tx) => {
        await expect(
          createStoryLocalization(
            tx,
            ADMIN,
            '00000000-0000-0000-0000-000000000000',
            { locale: 'ms' },
          ),
        ).rejects.toBeInstanceOf(NotFoundError);
      });
    });

    it('records the reviewer on review/publish transitions', async () => {
      await inRollbackTx(async (tx) => {
        const { ps } = await attach(tx, 'loc2');
        const loc = await createStoryLocalization(tx, ADMIN, ps.id, {
          locale: 'ms',
          headline: 'Tajuk',
        });
        expect(loc.reviewed_by).toBeNull();
        const reviewed = await setStoryLocalizationStatus(tx, ADMIN, loc.id, {
          status: 'REVIEW',
        });
        expect(reviewed.status).toBe('REVIEW');
        expect(reviewed.reviewed_by).toBe('alice');
        // Reverting to DRAFT clears the reviewer.
        const draft = await setStoryLocalizationStatus(tx, ADMIN, loc.id, {
          status: 'DRAFT',
        });
        expect(draft.reviewed_by).toBeNull();
      });
    });

    it('isolates localisations: a locale under one Publication never appears under another', async () => {
      await inRollbackTx(async (tx) => {
        const a = await attach(tx, 'iso-a');
        const b = await attach(tx, 'iso-b');
        await createStoryLocalization(tx, ADMIN, a.ps.id, {
          locale: 'ms',
          headline: 'A Malay',
        });
        const { StoryLocalizationRepository } = await import('@/domain');
        const repo = new StoryLocalizationRepository(tx);
        // The Malay row exists for A, and is absent for B (scoped by parent).
        expect(await repo.findByLocale(a.ps.id, 'ms')).not.toBeNull();
        expect(await repo.findByLocale(b.ps.id, 'ms')).toBeNull();
        expect(await repo.listForPublicationStory(b.ps.id)).toHaveLength(0);
      });
    });
  });
});
