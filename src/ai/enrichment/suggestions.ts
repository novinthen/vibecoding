import type { Db } from '@/db/client';
import { EntityRepository, TopicRepository } from '@/domain';
import { slugify } from '@/domain/slug';
import type {
  EntityRow,
  SuggestedEntity,
  SuggestedTopic,
  TopicRow,
} from '@/domain/types';

/**
 * Deterministic matching layer between AI suggestions and canonical records
 * (Stage 6).
 *
 * AI may PROPOSE Topics and Entities, but canonical relationships are never
 * written from a suggestion. This layer only READS: it resolves each suggestion
 * to an existing canonical Topic/Entity by exact, deterministic key (slug, or a
 * normalised Entity alias), and splits results into `matched` (a real canonical
 * record exists) and `unresolved` (no canonical match — remains an advisory
 * candidate that a human must review before anything is created). It creates
 * nothing: no Topic, no Entity, no alias, no relationship. That guarantees a
 * hallucinated name can never silently become a canonical record.
 */

export interface MatchedTopic {
  suggestion: SuggestedTopic;
  topic: TopicRow;
}

export interface MatchedEntity {
  suggestion: SuggestedEntity;
  entity: EntityRow;
}

export interface ResolvedSuggestions {
  matchedTopics: MatchedTopic[];
  unresolvedTopics: SuggestedTopic[];
  matchedEntities: MatchedEntity[];
  unresolvedEntities: SuggestedEntity[];
}

/**
 * Resolve suggestion candidates against canonical records. Purely read-only.
 * A suggestion matches a Topic when its slug (given, or derived from its name)
 * equals an existing Topic slug; it matches an Entity when the derived slug
 * equals an Entity slug or a normalised alias resolves to one.
 */
export async function resolveSuggestions(
  db: Db,
  suggestedTopics: SuggestedTopic[],
  suggestedEntities: SuggestedEntity[],
): Promise<ResolvedSuggestions> {
  const topics = new TopicRepository(db);
  const entities = new EntityRepository(db);

  const matchedTopics: MatchedTopic[] = [];
  const unresolvedTopics: SuggestedTopic[] = [];
  for (const suggestion of suggestedTopics) {
    const slug = suggestion.slug
      ? slugify(suggestion.slug)
      : slugify(suggestion.name);
    const topic = slug ? await topics.findBySlug(slug) : null;
    if (topic) matchedTopics.push({ suggestion, topic });
    else unresolvedTopics.push(suggestion);
  }

  const matchedEntities: MatchedEntity[] = [];
  const unresolvedEntities: SuggestedEntity[] = [];
  for (const suggestion of suggestedEntities) {
    const slug = slugify(suggestion.name);
    let entity: EntityRow | null = slug
      ? await entities.findBySlug(slug)
      : null;
    if (!entity && slug) {
      entity = await entities.findByNormalizedAlias(slug);
    }
    if (entity) matchedEntities.push({ suggestion, entity });
    else unresolvedEntities.push(suggestion);
  }

  return {
    matchedTopics,
    unresolvedTopics,
    matchedEntities,
    unresolvedEntities,
  };
}
