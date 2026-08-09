import type { Db } from '@/db/client';

import type { EntityType } from '../enums';
import type { EntityRow } from '../types';

export interface CreateEntityInput {
  entityType: EntityType;
  name: string;
  slug: string;
  description?: string | null;
  homepageUrl?: string | null;
  githubUrl?: string | null;
}

/** Data access for Entities and their aliases. */
export class EntityRepository {
  constructor(private readonly db: Db) {}

  async findBySlug(slug: string): Promise<EntityRow | null> {
    const result = await this.db.query<EntityRow>(
      'SELECT * FROM entities WHERE slug = $1',
      [slug],
    );
    return result.rows[0] ?? null;
  }

  /** Resolve a normalized alias to its canonical Entity, if any. */
  async findByNormalizedAlias(
    normalizedAlias: string,
  ): Promise<EntityRow | null> {
    const result = await this.db.query<EntityRow>(
      `SELECT e.* FROM entities e
       JOIN entity_aliases a ON a.entity_id = e.id
       WHERE a.normalized_alias = $1`,
      [normalizedAlias],
    );
    return result.rows[0] ?? null;
  }

  async create(input: CreateEntityInput): Promise<EntityRow> {
    const result = await this.db.query<EntityRow>(
      `INSERT INTO entities
         (entity_type, name, slug, description, homepage_url, github_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.entityType,
        input.name,
        input.slug,
        input.description ?? null,
        input.homepageUrl ?? null,
        input.githubUrl ?? null,
      ],
    );
    return result.rows[0] as EntityRow;
  }

  /**
   * Add an alias for an Entity. Idempotent on the globally-unique normalized
   * alias: a re-added alias is left pointing at its existing Entity.
   */
  async addAlias(
    entityId: string,
    alias: string,
    normalizedAlias: string,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO entity_aliases (entity_id, alias, normalized_alias)
       VALUES ($1, $2, $3)
       ON CONFLICT (normalized_alias) DO NOTHING`,
      [entityId, alias, normalizedAlias],
    );
  }
}
