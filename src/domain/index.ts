/**
 * Domain layer barrel.
 *
 * Re-exports the controlled vocabularies, seed data, helpers, row types, and
 * repositories so callers depend on `@/domain` rather than reaching into files.
 */
export * from './enums';
export * from './slug';
export * from './topics';
export * from './types';
export { TopicRepository } from './repositories/topic-repository';
export {
  SourceRepository,
  type CreateSourceInput,
} from './repositories/source-repository';
export {
  ArticleRepository,
  type CreateArticleInput,
} from './repositories/article-repository';
export {
  StoryRepository,
  type CreateStoryInput,
} from './repositories/story-repository';
export {
  EntityRepository,
  type CreateEntityInput,
} from './repositories/entity-repository';
