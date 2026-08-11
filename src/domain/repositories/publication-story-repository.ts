import type { Db } from '@/db/client';

import type { PublicationStoryStatus } from '../enums';
import type { PublicationStoryRow } from '../types';

/** Presentation fields written when attaching or editing a PublicationStory. */
export interface PublicationStoryInput {
  slug: string | null;
  headline: string | null;
  publishedSummary: string | null;
  publishedWhyItMatters: string | null;
  featured: boolean;
  editorialPriority: number;
  suppressRanking: boolean;
}

/** A PublicationStory joined with the canonical Story it presents (admin view). */
export interface PublicationStoryWithStoryRow extends PublicationStoryRow {
  story_slug: string;
  story_canonical_title: string;
  story_status: string;
}

/**
 * Data access for PublicationStory — the per-Publication publishing control for
 * a canonical Story.
 *
 * A PublicationStory only ever carries publication-specific PRESENTATION
 * (slug/headline/summary/why-it-matters/status/featured/priority). It never
 * touches canonical Story facts: those live on the `stories` row and are read
 * here only for display. The (publication_id, story_id) uniqueness constraint
 * prevents attaching the same Story to a Publication twice; one Story may still
 * be attached by many Publications.
 */
export class PublicationStoryRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<PublicationStoryRow | null> {
    const result = await this.db.query<PublicationStoryRow>(
      'SELECT * FROM publication_stories WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  }

  /** Existing attachment of a Story to a Publication, or null. */
  async findByPublicationAndStory(
    publicationId: string,
    storyId: string,
  ): Promise<PublicationStoryRow | null> {
    const result = await this.db.query<PublicationStoryRow>(
      `SELECT * FROM publication_stories
       WHERE publication_id = $1 AND story_id = $2`,
      [publicationId, storyId],
    );
    return result.rows[0] ?? null;
  }

  /** A publication's slug claim within itself (per-Publication slug uniqueness). */
  async findByPublicationAndSlug(
    publicationId: string,
    slug: string,
  ): Promise<PublicationStoryRow | null> {
    const result = await this.db.query<PublicationStoryRow>(
      `SELECT * FROM publication_stories
       WHERE publication_id = $1 AND slug = $2`,
      [publicationId, slug],
    );
    return result.rows[0] ?? null;
  }

  /** All PublicationStories for a Publication, with their canonical Story. */
  async listForPublication(
    publicationId: string,
  ): Promise<PublicationStoryWithStoryRow[]> {
    const result = await this.db.query<PublicationStoryWithStoryRow>(
      `SELECT ps.*,
              st.slug AS story_slug,
              st.canonical_title AS story_canonical_title,
              st.status AS story_status
       FROM publication_stories ps
       JOIN stories st ON st.id = ps.story_id
       WHERE ps.publication_id = $1
       ORDER BY ps.featured DESC, ps.editorial_priority DESC, ps.updated_at DESC`,
      [publicationId],
    );
    return result.rows;
  }

  async create(input: {
    publicationId: string;
    storyId: string;
    values: PublicationStoryInput;
  }): Promise<PublicationStoryRow> {
    const { publicationId, storyId, values } = input;
    const result = await this.db.query<PublicationStoryRow>(
      `INSERT INTO publication_stories
         (publication_id, story_id, slug, headline,
          published_summary, published_why_it_matters,
          featured, editorial_priority, suppress_ranking)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        publicationId,
        storyId,
        values.slug,
        values.headline,
        values.publishedSummary,
        values.publishedWhyItMatters,
        values.featured,
        values.editorialPriority,
        values.suppressRanking,
      ],
    );
    return result.rows[0] as PublicationStoryRow;
  }

  /** Edit presentation fields. Status/published_at are managed separately. */
  async update(
    id: string,
    values: PublicationStoryInput,
  ): Promise<PublicationStoryRow | null> {
    const result = await this.db.query<PublicationStoryRow>(
      `UPDATE publication_stories SET
         slug                     = $2,
         headline                 = $3,
         published_summary        = $4,
         published_why_it_matters = $5,
         featured                 = $6,
         editorial_priority       = $7,
         suppress_ranking         = $8
       WHERE id = $1
       RETURNING *`,
      [
        id,
        values.slug,
        values.headline,
        values.publishedSummary,
        values.publishedWhyItMatters,
        values.featured,
        values.editorialPriority,
        values.suppressRanking,
      ],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Transition publishing status. Moving into PUBLISHED stamps `published_at`
   * once (kept on subsequent edits); leaving PUBLISHED preserves the historical
   * timestamp. Canonical Story facts are never touched.
   */
  async setStatus(
    id: string,
    status: PublicationStoryStatus,
  ): Promise<PublicationStoryRow | null> {
    const result = await this.db.query<PublicationStoryRow>(
      `UPDATE publication_stories SET
         status = $2,
         published_at = CASE
           WHEN $2 = 'PUBLISHED' AND published_at IS NULL THEN now()
           ELSE published_at
         END
       WHERE id = $1
       RETURNING *`,
      [id, status],
    );
    return result.rows[0] ?? null;
  }
}
