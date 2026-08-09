import { slugify } from './slug';

/**
 * Controlled top-level taxonomy (PRODUCT.md / DATA_MODEL.md).
 *
 * These are the ONLY top-level Topics. They are editorially controlled: AI may
 * assign existing Topics but must never create new top-level categories
 * automatically. Order is significant and stable — treat this list as the
 * canonical seed definition.
 */
export const TOP_LEVEL_TOPIC_NAMES = [
  'News',
  'Releases',
  'Tools',
  'Coding Agents',
  'Models',
  'MCP',
  'Open Source',
  'Developer Infrastructure',
  'Tutorials',
  'Research',
  'Business',
  'Community',
] as const;

export type TopLevelTopicName = (typeof TOP_LEVEL_TOPIC_NAMES)[number];

export interface TopicSeed {
  name: string;
  slug: string;
}

/**
 * The concrete seed rows, with deterministic slugs. Exposed as data (not a
 * side-effecting import) so it can be unit-tested and reused by the seed script.
 */
export const TOP_LEVEL_TOPIC_SEEDS: readonly TopicSeed[] =
  TOP_LEVEL_TOPIC_NAMES.map((name) => ({ name, slug: slugify(name) }));
