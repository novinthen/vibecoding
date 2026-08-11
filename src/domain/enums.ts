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

/**
 * Provenance of a StoryLocalization's text. Mirrors the CHECK constraint on
 * story_localizations.translation_source. HUMAN = editorially authored/translated;
 * MACHINE = imported machine translation (no automated provider runs in Stage 5B);
 * MACHINE_REVIEWED = machine output a human has reviewed.
 */
export const TRANSLATION_SOURCES = [
  'HUMAN',
  'MACHINE',
  'MACHINE_REVIEWED',
] as const;
export const translationSourceSchema = z.enum(TRANSLATION_SOURCES);
export type TranslationSource = z.infer<typeof translationSourceSchema>;

/**
 * Outcome of one AI enrichment attempt (Stage 6). Mirrors the CHECK constraint
 * on article_enrichments.status. Every attempt is persisted as its own version:
 * SUCCEEDED = validated structured output; INVALID_OUTPUT = provider replied but
 * failed strict schema validation (raw kept for audit); PROVIDER_ERROR = the
 * provider call itself failed (misconfigured, unavailable, rate-limited, etc.).
 */
export const ENRICHMENT_STATUSES = [
  'SUCCEEDED',
  'INVALID_OUTPUT',
  'PROVIDER_ERROR',
] as const;
export const enrichmentStatusSchema = z.enum(ENRICHMENT_STATUSES);
export type EnrichmentStatus = z.infer<typeof enrichmentStatusSchema>;

/**
 * Advisory relevance classification for the vibe-coding domain (Stage 6). Mirrors
 * the CHECK constraint on article_enrichments.relevance. The model may only
 * return the first three; UNCLASSIFIED is assigned by the system to failed or
 * unvalidated attempts. A RELEVANT classification is advisory and NEVER publishes
 * an Article on its own — promotion is a separate, explicit, approved workflow.
 */
export const RELEVANCE_CLASSIFICATIONS = [
  'RELEVANT',
  'MAYBE_RELEVANT',
  'IRRELEVANT',
  'UNCLASSIFIED',
] as const;
export const relevanceClassificationSchema = z.enum(RELEVANCE_CLASSIFICATIONS);
export type RelevanceClassification = z.infer<
  typeof relevanceClassificationSchema
>;

/** The relevance values a model is permitted to return (excludes UNCLASSIFIED). */
export const MODEL_RELEVANCE_VALUES = [
  'RELEVANT',
  'MAYBE_RELEVANT',
  'IRRELEVANT',
] as const;
export const modelRelevanceSchema = z.enum(MODEL_RELEVANCE_VALUES);
export type ModelRelevance = z.infer<typeof modelRelevanceSchema>;

/**
 * Story review state (Stage 7). Mirrors the CHECK constraint on
 * stories.review_state. UNREVIEWED is the default state of an automatically
 * formed Story; REVIEWED and LOCKED both mark an editor decision the clustering
 * engine must NEVER autonomously restructure (false-merge / silent-split
 * protection). Only explicit, audited admin operations may change a protected
 * Story's membership. LOCKED is a stronger editorial freeze than REVIEWED.
 */
export const STORY_REVIEW_STATES = [
  'UNREVIEWED',
  'REVIEWED',
  'LOCKED',
] as const;
export const storyReviewStateSchema = z.enum(STORY_REVIEW_STATES);
export type StoryReviewState = z.infer<typeof storyReviewStateSchema>;

/** Review states the clustering engine treats as protected from auto-changes. */
export const PROTECTED_STORY_REVIEW_STATES: ReadonlySet<StoryReviewState> =
  new Set<StoryReviewState>(['REVIEWED', 'LOCKED']);

/**
 * How a Story or clustering decision came to be (Stage 7). AUTOMATIC = produced
 * by the clustering engine; MANUAL = produced by an explicit editor action.
 * Mirrors stories.formation_source and clustering_decisions.decision_source.
 */
export const CLUSTERING_SOURCES = ['AUTOMATIC', 'MANUAL'] as const;
export const clusteringSourceSchema = z.enum(CLUSTERING_SOURCES);
export type ClusteringSource = z.infer<typeof clusteringSourceSchema>;

/**
 * Terminal outcome of one clustering attempt for an Article (Stage 7). Mirrors
 * the CHECK constraint on clustering_decisions.decision. A new Story is always
 * formed when there is no confident match, so "no candidates" / "below threshold"
 * are recorded in the decision's `reason`, not as separate outcomes:
 *  - CREATED_STORY      — no confident match; a new Story was formed;
 *  - ASSIGNED_EXISTING  — attached to a single confidently-matched Story;
 *  - AMBIGUOUS          — multiple Stories matched within the ambiguity margin, so
 *                         the engine refused to merge (false-split > false-merge);
 *  - SKIPPED_EXISTING   — the Article is already clustered; a re-run made no change;
 *  - SKIPPED_PROTECTED  — the best match is a REVIEWED/LOCKED Story, left for an
 *                         explicit editorial workflow.
 */
export const CLUSTERING_DECISIONS = [
  'CREATED_STORY',
  'ASSIGNED_EXISTING',
  'AMBIGUOUS',
  'SKIPPED_EXISTING',
  'SKIPPED_PROTECTED',
] as const;
export const clusteringDecisionSchema = z.enum(CLUSTERING_DECISIONS);
export type ClusteringDecision = z.infer<typeof clusteringDecisionSchema>;
