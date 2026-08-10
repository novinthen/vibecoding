import { z } from 'zod';

/**
 * Controlled domain vocabularies.
 *
 * These mirror the CHECK constraints defined in the SQL migrations so that the
 * TypeScript layer and the database agree on a single source of truth for
 * allowed values. Each vocabulary is expressed once as a readonly tuple, then
 * derived into a Zod schema and a TypeScript union. Keep this file in sync with
 * the migrations whenever a controlled value changes.
 */

export const SOURCE_TYPES = [
  'RSS',
  'ATOM',
  'GITHUB',
  'HACKER_NEWS',
  'RSSHUB',
  'API',
  'MANUAL',
] as const;
export const sourceTypeSchema = z.enum(SOURCE_TYPES);
export type SourceType = z.infer<typeof sourceTypeSchema>;

export const AUTHORITY_TIERS = [
  'PRIMARY',
  'TRUSTED',
  'SPECIALIST',
  'COMMUNITY',
  'DISCOVERY',
] as const;
export const authorityTierSchema = z.enum(AUTHORITY_TIERS);
export type AuthorityTier = z.infer<typeof authorityTierSchema>;

export const HEALTH_STATUSES = [
  'HEALTHY',
  'DEGRADED',
  'FAILING',
  'DISABLED',
  'UNKNOWN',
] as const;
export const healthStatusSchema = z.enum(HEALTH_STATUSES);
export type HealthStatus = z.infer<typeof healthStatusSchema>;

export const SOURCE_FETCH_STATUSES = [
  'STARTED',
  'SUCCESS',
  'PARTIAL',
  'FAILED',
  'SKIPPED',
] as const;
export const sourceFetchStatusSchema = z.enum(SOURCE_FETCH_STATUSES);
export type SourceFetchStatus = z.infer<typeof sourceFetchStatusSchema>;

export const ARTICLE_STATUSES = [
  'DISCOVERED',
  'NORMALIZED',
  'DUPLICATE',
  'QUEUED',
  'ENRICHED',
  'CLUSTERED',
  'PUBLISHED',
  'HIDDEN',
  'FAILED',
] as const;
export const articleStatusSchema = z.enum(ARTICLE_STATUSES);
export type ArticleStatus = z.infer<typeof articleStatusSchema>;

export const STORY_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'MERGED',
  'SUPPRESSED',
  'ARCHIVED',
] as const;
export const storyStatusSchema = z.enum(STORY_STATUSES);
export type StoryStatus = z.infer<typeof storyStatusSchema>;

export const STORY_ARTICLE_RELATIONSHIPS = [
  'PRIMARY',
  'SUPPORTING',
  'OFFICIAL',
  'REACTION',
  'COMMENTARY',
  'RELATED',
] as const;
export const storyArticleRelationshipSchema = z.enum(
  STORY_ARTICLE_RELATIONSHIPS,
);
export type StoryArticleRelationship = z.infer<
  typeof storyArticleRelationshipSchema
>;

export const ENTITY_TYPES = [
  'COMPANY',
  'PRODUCT',
  'MODEL',
  'PROTOCOL',
  'REPOSITORY',
  'PERSON',
  'ORGANIZATION',
] as const;
export const entityTypeSchema = z.enum(ENTITY_TYPES);
export type EntityType = z.infer<typeof entityTypeSchema>;

export const ENTITY_RELATIONSHIPS = [
  'SUBJECT',
  'MENTION',
  'AUTHOR',
  'CREATOR',
  'ACQUIRER',
  'PARTNER',
  'COMPETITOR',
] as const;
export const entityRelationshipSchema = z.enum(ENTITY_RELATIONSHIPS);
export type EntityRelationship = z.infer<typeof entityRelationshipSchema>;

/**
 * Administrator roles (Stage 4). Mirrors the future role set named in
 * docs/ARCHITECTURE.md. Stage 4 authorization is deliberately coarse: ADMIN and
 * EDITOR may perform the implemented editorial mutations; VIEWER is read-only.
 * These are application-level roles (admins are env-configured, not DB rows), so
 * there is no corresponding SQL CHECK constraint.
 */
export const ADMIN_ROLES = ['ADMIN', 'EDITOR', 'VIEWER'] as const;
export const adminRoleSchema = z.enum(ADMIN_ROLES);
export type AdminRole = z.infer<typeof adminRoleSchema>;

export const PUBLICATION_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
export const publicationStatusSchema = z.enum(PUBLICATION_STATUSES);
export type PublicationStatus = z.infer<typeof publicationStatusSchema>;

export const PUBLICATION_STORY_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'PUBLISHED',
  'UNPUBLISHED',
  'ARCHIVED',
] as const;
export const publicationStoryStatusSchema = z.enum(PUBLICATION_STORY_STATUSES);
export type PublicationStoryStatus = z.infer<
  typeof publicationStoryStatusSchema
>;

export const LOCALIZATION_STATUSES = [
  'DRAFT',
  'REVIEW',
  'PUBLISHED',
  'ARCHIVED',
] as const;
export const localizationStatusSchema = z.enum(LOCALIZATION_STATUSES);
export type LocalizationStatus = z.infer<typeof localizationStatusSchema>;
