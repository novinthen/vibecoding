import type { Db } from '@/db/client';

import type { PublicationStatus } from '../enums';
import type { PublicationDomainRow, PublicationRow } from '../types';

/** Fields accepted when creating a Publication. */
export interface CreatePublicationInput {
  name: string;
  slug: string;
  defaultLocale: string;
  timezone: string;
  editorialProfile?: Record<string, unknown>;
  branding?: Record<string, unknown>;
  seoSettings?: Record<string, unknown>;
}

/** Fields an admin may edit on an existing Publication (slug is immutable). */
export interface UpdatePublicationInput {
  name: string;
  defaultLocale: string;
  timezone: string;
  editorialProfile: Record<string, unknown>;
  branding: Record<string, unknown>;
  seoSettings: Record<string, unknown>;
}

/**
 * Data access for Publications and their domains.
 *
 * Resolution is `hostname → PublicationDomain → Publication`. Only ACTIVE
 * Publications reached through an ENABLED domain are resolvable publicly, so a
 * disabled domain or an archived Publication cannot be served. The domain is
 * matched exactly (already normalised by the caller) and is globally unique, so
 * at most one row can match.
 *
 * The admin-facing CRUD here is the Stage 5B management surface: it lists,
 * creates, edits, and (de)activates Publications, and adds/removes/toggles their
 * domains. Canonical intelligence stays global; these rows only carry
 * publication-specific configuration and hostname mapping.
 */
export class PublicationRepository {
  constructor(private readonly db: Db) {}

  /**
   * Resolve the active Publication served at `domain`, or null when no enabled
   * domain maps to an active Publication. `domain` must already be normalised
   * (lowercased, port-stripped).
   */
  async findByDomain(domain: string): Promise<PublicationRow | null> {
    const result = await this.db.query<PublicationRow>(
      `SELECT p.*
       FROM publication_domains d
       JOIN publications p ON p.id = d.publication_id
       WHERE d.domain = $1
         AND d.enabled = true
         AND p.status = 'ACTIVE'
       LIMIT 1`,
      [domain],
    );
    return result.rows[0] ?? null;
  }

  async findBySlug(slug: string): Promise<PublicationRow | null> {
    const result = await this.db.query<PublicationRow>(
      'SELECT * FROM publications WHERE slug = $1',
      [slug],
    );
    return result.rows[0] ?? null;
  }

  async findById(id: string): Promise<PublicationRow | null> {
    const result = await this.db.query<PublicationRow>(
      'SELECT * FROM publications WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  }

  /** All Publications (admin view), most recently created first. */
  async listAll(): Promise<PublicationRow[]> {
    const result = await this.db.query<PublicationRow>(
      'SELECT * FROM publications ORDER BY created_at DESC',
    );
    return result.rows;
  }

  async create(input: CreatePublicationInput): Promise<PublicationRow> {
    const result = await this.db.query<PublicationRow>(
      `INSERT INTO publications
         (name, slug, default_locale, timezone,
          editorial_profile, branding, seo_settings)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
       RETURNING *`,
      [
        input.name,
        input.slug,
        input.defaultLocale,
        input.timezone,
        JSON.stringify(input.editorialProfile ?? {}),
        JSON.stringify(input.branding ?? {}),
        JSON.stringify(input.seoSettings ?? {}),
      ],
    );
    return result.rows[0] as PublicationRow;
  }

  /** Apply an admin edit to the permitted Publication fields. */
  async update(
    id: string,
    input: UpdatePublicationInput,
  ): Promise<PublicationRow | null> {
    const result = await this.db.query<PublicationRow>(
      `UPDATE publications SET
         name             = $2,
         default_locale   = $3,
         timezone         = $4,
         editorial_profile = $5::jsonb,
         branding         = $6::jsonb,
         seo_settings     = $7::jsonb
       WHERE id = $1
       RETURNING *`,
      [
        id,
        input.name,
        input.defaultLocale,
        input.timezone,
        JSON.stringify(input.editorialProfile),
        JSON.stringify(input.branding),
        JSON.stringify(input.seoSettings),
      ],
    );
    return result.rows[0] ?? null;
  }

  /** Activate/deactivate/archive a Publication. */
  async setStatus(
    id: string,
    status: PublicationStatus,
  ): Promise<PublicationRow | null> {
    const result = await this.db.query<PublicationRow>(
      'UPDATE publications SET status = $2 WHERE id = $1 RETURNING *',
      [id, status],
    );
    return result.rows[0] ?? null;
  }

  // --- Domains -------------------------------------------------------------

  /** Domains for one Publication, primary first then alphabetical. */
  async listDomains(publicationId: string): Promise<PublicationDomainRow[]> {
    const result = await this.db.query<PublicationDomainRow>(
      `SELECT * FROM publication_domains
       WHERE publication_id = $1
       ORDER BY is_primary DESC, domain ASC`,
      [publicationId],
    );
    return result.rows;
  }

  async findDomainById(id: string): Promise<PublicationDomainRow | null> {
    const result = await this.db.query<PublicationDomainRow>(
      'SELECT * FROM publication_domains WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  }

  /** Look up any Publication's claim on a (normalised) domain — uniqueness check. */
  async findDomainByHost(domain: string): Promise<PublicationDomainRow | null> {
    const result = await this.db.query<PublicationDomainRow>(
      'SELECT * FROM publication_domains WHERE domain = $1',
      [domain],
    );
    return result.rows[0] ?? null;
  }

  async addDomain(input: {
    publicationId: string;
    domain: string;
    isPrimary: boolean;
    enabled: boolean;
  }): Promise<PublicationDomainRow> {
    const result = await this.db.query<PublicationDomainRow>(
      `INSERT INTO publication_domains
         (publication_id, domain, is_primary, enabled)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.publicationId, input.domain, input.isPrimary, input.enabled],
    );
    return result.rows[0] as PublicationDomainRow;
  }

  async setDomainEnabled(
    id: string,
    enabled: boolean,
  ): Promise<PublicationDomainRow | null> {
    const result = await this.db.query<PublicationDomainRow>(
      'UPDATE publication_domains SET enabled = $2 WHERE id = $1 RETURNING *',
      [id, enabled],
    );
    return result.rows[0] ?? null;
  }

  async removeDomain(id: string): Promise<void> {
    await this.db.query('DELETE FROM publication_domains WHERE id = $1', [id]);
  }

  /**
   * Make one domain the sole primary for its Publication. Clears any existing
   * primary first, then sets this one — the partial unique index
   * (`WHERE is_primary`) guarantees at most one primary, and doing both writes
   * in the caller's transaction keeps the invariant atomic.
   */
  async setPrimaryDomain(
    id: string,
    publicationId: string,
  ): Promise<PublicationDomainRow | null> {
    await this.db.query(
      `UPDATE publication_domains SET is_primary = false
       WHERE publication_id = $1 AND is_primary = true AND id <> $2`,
      [publicationId, id],
    );
    const result = await this.db.query<PublicationDomainRow>(
      'UPDATE publication_domains SET is_primary = true WHERE id = $1 RETURNING *',
      [id],
    );
    return result.rows[0] ?? null;
  }
}
