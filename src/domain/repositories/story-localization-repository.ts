import type { Db } from '@/db/client';

import type { LocalizationStatus, TranslationSource } from '../enums';
import type { StoryLocalizationRow } from '../types';

/** Editorial/localised fields written when creating or editing a localisation. */
export interface StoryLocalizationInput {
  locale: string;
  headline: string | null;
  summary: string | null;
  whyItMatters: string | null;
  translationSource: TranslationSource | null;
  modelProvider: string | null;
  modelName: string | null;
}

/**
 * Data access for StoryLocalization — locale-specific editorial variants of a
 * published Story, hanging off a PublicationStory (Story → PublicationStory →
 * StoryLocalization).
 *
 * Languages are ROWS keyed by `locale`, never columns; the (publication_story_id,
 * locale) uniqueness constraint enforces one localisation per locale per
 * PublicationStory. Because a localisation references `publication_story_id`
 * (not publication_id + story_id), it is structurally impossible to localise a
 * (publication, story) pair that was never attached, and it cannot leak across
 * Publications — every query is scoped by the parent PublicationStory.
 */
export class StoryLocalizationRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<StoryLocalizationRow | null> {
    const result = await this.db.query<StoryLocalizationRow>(
      'SELECT * FROM story_localizations WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  }

  /** All localisations for one PublicationStory, by locale. */
  async listForPublicationStory(
    publicationStoryId: string,
  ): Promise<StoryLocalizationRow[]> {
    const result = await this.db.query<StoryLocalizationRow>(
      `SELECT * FROM story_localizations
       WHERE publication_story_id = $1
       ORDER BY locale ASC`,
      [publicationStoryId],
    );
    return result.rows;
  }

  /** A specific (publicationStory, locale) localisation, or null. */
  async findByLocale(
    publicationStoryId: string,
    locale: string,
  ): Promise<StoryLocalizationRow | null> {
    const result = await this.db.query<StoryLocalizationRow>(
      `SELECT * FROM story_localizations
       WHERE publication_story_id = $1 AND locale = $2`,
      [publicationStoryId, locale],
    );
    return result.rows[0] ?? null;
  }

  async create(input: {
    publicationStoryId: string;
    values: StoryLocalizationInput;
  }): Promise<StoryLocalizationRow> {
    const { publicationStoryId, values } = input;
    const result = await this.db.query<StoryLocalizationRow>(
      `INSERT INTO story_localizations
         (publication_story_id, locale, headline, summary, why_it_matters,
          translation_source, model_provider, model_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        publicationStoryId,
        values.locale,
        values.headline,
        values.summary,
        values.whyItMatters,
        values.translationSource,
        values.modelProvider,
        values.modelName,
      ],
    );
    return result.rows[0] as StoryLocalizationRow;
  }

  /** Edit localised text/provenance. Locale (identity) and status are separate. */
  async update(
    id: string,
    values: Omit<StoryLocalizationInput, 'locale'>,
  ): Promise<StoryLocalizationRow | null> {
    const result = await this.db.query<StoryLocalizationRow>(
      `UPDATE story_localizations SET
         headline           = $2,
         summary            = $3,
         why_it_matters     = $4,
         translation_source = $5,
         model_provider     = $6,
         model_name         = $7
       WHERE id = $1
       RETURNING *`,
      [
        id,
        values.headline,
        values.summary,
        values.whyItMatters,
        values.translationSource,
        values.modelProvider,
        values.modelName,
      ],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Transition localisation status (DRAFT → REVIEW → PUBLISHED / ARCHIVED).
   * `reviewedBy` records the reviewing editor when advancing review/publish
   * state; pass null to leave it unchanged from the caller's perspective (the
   * column is overwritten with the provided value).
   */
  async setStatus(
    id: string,
    status: LocalizationStatus,
    reviewedBy: string | null,
  ): Promise<StoryLocalizationRow | null> {
    const result = await this.db.query<StoryLocalizationRow>(
      `UPDATE story_localizations SET
         status = $2,
         reviewed_by = $3
       WHERE id = $1
       RETURNING *`,
      [id, status, reviewedBy],
    );
    return result.rows[0] ?? null;
  }
}
