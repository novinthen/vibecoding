import type { Db } from '@/db/client';

import type { PublicationRow } from '../types';

/**
 * Data access for Publications and their domains.
 *
 * Resolution is `hostname → PublicationDomain → Publication`. Only ACTIVE
 * Publications reached through an ENABLED domain are resolvable publicly, so a
 * disabled domain or an archived Publication cannot be served. The domain is
 * matched exactly (already normalised by the caller) and is globally unique, so
 * at most one row can match.
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
}
