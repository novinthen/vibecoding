import type { Db } from '@/db/client';

import type { StoryArticleRelationship } from '../enums';
import type { StoryRow } from '../types';

export interface CreateStoryInput {
  slug: string;
  canonicalTitle: string;
  primaryTopicId?: string | null;
}

/**
 * Data access for Stories and Story↔Article membership.
 *
 * A Story is distinct from an Article; membership is expressed through the
 * story_articles join, never by folding one concept into the other.
 */
export class StoryRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<StoryRow | null> {
    const result = await this.db.query<StoryRow>(
      'SELECT * FROM stories WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findBySlug(slug: string): Promise<StoryRow | null> {
    const result = await this.db.query<StoryRow>(
      'SELECT * FROM stories WHERE slug = $1',
      [slug],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Recent Stories (admin view), most recently active first. Used when attaching
   * a canonical Story to a Publication — the editor picks a real Story, so no
   * fake Story is ever invented to demonstrate publishing.
   */
  async listRecent(limit = 100): Promise<StoryRow[]> {
    const capped = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const result = await this.db.query<StoryRow>(
      `SELECT * FROM stories
       ORDER BY last_activity_at DESC NULLS LAST, created_at DESC
       LIMIT $1`,
      [capped],
    );
    return result.rows;
  }

  async create(input: CreateStoryInput): Promise<StoryRow> {
    const result = await this.db.query<StoryRow>(
      `INSERT INTO stories (slug, canonical_title, primary_topic_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [input.slug, input.canonicalTitle, input.primaryTopicId ?? null],
    );
    return result.rows[0] as StoryRow;
  }

  /**
   * Link an Article to a Story. Idempotent on the (story, article) primary key:
   * an existing link is left unchanged rather than duplicated.
   */
  async addArticle(
    storyId: string,
    articleId: string,
    relationshipType: StoryArticleRelationship = 'RELATED',
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO story_articles (story_id, article_id, relationship_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (story_id, article_id) DO NOTHING`,
      [storyId, articleId, relationshipType],
    );
  }

  /** Return the Articles belonging to a Story. */
  async listArticleIds(storyId: string): Promise<string[]> {
    const result = await this.db.query<{ article_id: string }>(
      'SELECT article_id FROM story_articles WHERE story_id = $1',
      [storyId],
    );
    return result.rows.map((row) => row.article_id);
  }
}
