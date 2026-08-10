/**
 * Domain layer barrel.
 *
 * Re-exports the controlled vocabularies, seed data, helpers, row types, and
 * repositories so callers depend on `@/domain` rather than reaching into files.
 */
export * from './enums';
export * from './locale';
export * from './slug';
export * from './topics';
export * from './types';
export {
  PUBLIC_ARTICLE_STATUSES,
  isPubliclyVisibleArticle,
  publicArticleStatusSql,
} from './article-visibility';
export { TopicRepository } from './repositories/topic-repository';
export {
  SourceRepository,
  type CreateSourceInput,
  type UpdateSourceInput,
  type UpdateFetchStateInput,
} from './repositories/source-repository';
export {
  SourceFetchRepository,
  type CompleteFetchInput,
  type SourceFetchWithSourceRow,
} from './repositories/source-fetch-repository';
export {
  ArticleRepository,
  type CreateArticleInput,
  type ArticleFilter,
} from './repositories/article-repository';
export {
  AdminAuditLogRepository,
  type RecordAuditInput,
  type ListAuditOptions,
} from './repositories/admin-audit-log-repository';
export {
  StoryRepository,
  type CreateStoryInput,
} from './repositories/story-repository';
export {
  EntityRepository,
  type CreateEntityInput,
} from './repositories/entity-repository';
export {
  ArticleEnrichmentRepository,
  type CreateEnrichmentInput,
} from './repositories/article-enrichment-repository';
export {
  PublicationRepository,
  type CreatePublicationInput,
  type UpdatePublicationInput,
} from './repositories/publication-repository';
export {
  PublicationStoryRepository,
  type PublicationStoryInput,
  type PublicationStoryWithStoryRow,
} from './repositories/publication-story-repository';
export {
  StoryLocalizationRepository,
  type StoryLocalizationInput,
} from './repositories/story-localization-repository';
export {
  PublicContentRepository,
  type PublicArticleQuery,
} from './repositories/public-content-repository';
