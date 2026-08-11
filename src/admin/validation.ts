import { z } from 'zod';

import {
  articleStatusSchema,
  authorityTierSchema,
  localizationStatusSchema,
  publicationStatusSchema,
  publicationStoryStatusSchema,
  sourceTypeSchema,
  translationSourceSchema,
} from '@/domain/enums';
import { canonicalizeLocale } from '@/domain/locale';

/**
 * Server-side validation for admin mutations (Stage 4).
 *
 * All admin input is untrusted (docs/ARCHITECTURE.md security boundaries) and is
 * validated here before any repository write. These schemas are the single
 * source of truth for what an admin form may submit; server actions parse with
 * them and surface field errors, and the services re-parse defensively.
 */

/** A slug: lowercase alphanumeric words separated by single hyphens. */
const slugSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Must be lowercase alphanumeric words separated by single hyphens.',
  );

/** Optional http(s) URL. Empty string is treated as "not provided" (null). */
const optionalHttpUrl = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (value) => value === '' || /^https?:\/\//i.test(value),
    'Must be an http(s) URL.',
  )
  .refine((value) => {
    if (value === '') return true;
    try {
      void new URL(value);
      return true;
    } catch {
      return false;
    }
  }, 'Must be a valid URL.')
  .transform((value) => (value === '' ? null : value));

const optionalLanguage = z
  .string()
  .trim()
  .max(20)
  .regex(/^[a-zA-Z-]*$/, 'Invalid language code.')
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional();

/**
 * Poll interval in seconds. Accepts a string (form field) or number; empty →
 * null (use the default cadence). Bounded to a sane positive range.
 */
const optionalPollInterval = z
  .union([z.string(), z.number()])
  .transform((value, ctx) => {
    if (value === '' || value === null || value === undefined) return null;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(n) || n <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Poll interval must be a positive whole number of seconds.',
      });
      return z.NEVER;
    }
    return n;
  })
  .nullable()
  .optional();

const optionalTopicId = z
  .string()
  .uuid()
  .nullable()
  .optional()
  .or(z.literal('').transform(() => null));

/**
 * Source-type adapter configuration as an already-assembled object (the server
 * action builds it from the type-specific form fields). Here it is only shape-
 * checked as "an object or undefined"; the AUTHORITATIVE per-type validation
 * (owner/repo/mode/bounds) happens in the source service via
 * {@link import('@/ingestion/source-config').sourceConfigForStorage}, because the
 * Source type selects which config schema applies. `undefined` means "no config
 * submitted" (RSS/Atom, or an edit that left config untouched).
 */
const optionalSourceConfigObject = z.record(z.string(), z.unknown()).optional();

export const createSourceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: slugSchema.optional(),
  sourceType: sourceTypeSchema,
  authorityTier: authorityTierSchema,
  homepageUrl: optionalHttpUrl.optional(),
  feedUrl: optionalHttpUrl.optional(),
  language: optionalLanguage,
  pollInterval: optionalPollInterval,
  defaultTopicId: optionalTopicId,
  sourceConfig: optionalSourceConfigObject,
});
export type CreateSourceValues = z.infer<typeof createSourceSchema>;

/** Edit form: slug and source_type are immutable and not accepted here. */
export const updateSourceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  authorityTier: authorityTierSchema,
  homepageUrl: optionalHttpUrl.optional(),
  feedUrl: optionalHttpUrl.optional(),
  language: optionalLanguage,
  pollInterval: optionalPollInterval,
  defaultTopicId: optionalTopicId,
  sourceConfig: optionalSourceConfigObject,
});
export type UpdateSourceValues = z.infer<typeof updateSourceSchema>;

export const setEnabledSchema = z.object({
  enabled: z.boolean(),
});

export const updateArticleStatusSchema = z.object({
  status: articleStatusSchema,
});

export const createTopicSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema.optional(),
  description: z
    .string()
    .trim()
    .max(500)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional(),
  parentId: z.string().uuid(),
});
export type CreateTopicValues = z.infer<typeof createTopicSchema>;

export const updateTopicSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z
    .string()
    .trim()
    .max(500)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional(),
});
export type UpdateTopicValues = z.infer<typeof updateTopicSchema>;

export const loginSchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(1024),
});

// ---------------------------------------------------------------------------
// Stage 5B — Publications, domains, publication stories, localisations.
// ---------------------------------------------------------------------------

/** A BCP-47-ish locale, normalised to canonical case (e.g. `en`, `en-US`). */
const localeSchema = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .transform((value, ctx) => {
    const canonical = canonicalizeLocale(value);
    if (!canonical) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Must be a valid locale like "en", "ms", "en-US", or "zh-Hans".',
      });
      return z.NEVER;
    }
    return canonical;
  });

/** An IANA time zone, validated against the runtime's zone database. */
const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      // Throws a RangeError for an unknown/ill-formed zone.
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Must be a valid IANA time zone, e.g. "UTC" or "Asia/Kuala_Lumpur".');

/**
 * A bare hostname (no scheme, port, or path). Lowercased; matched exactly
 * against publication_domains, so it must be the real served host. `localhost`
 * is permitted for local development.
 */
const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .refine(
    (value) =>
      value === 'localhost' ||
      /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(value),
    'Must be a bare hostname like "news.example.com" (no scheme, port, or path).',
  );

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

export const createPublicationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: slugSchema.optional(),
  defaultLocale: localeSchema,
  timezone: timezoneSchema,
  brandingName: optionalText(200),
  tagline: optionalText(300),
  seoDescription: optionalText(500),
  positioning: optionalText(500),
  audience: optionalText(300),
});
export type CreatePublicationValues = z.infer<typeof createPublicationSchema>;

/** Edit form: slug is immutable identity and not accepted here. */
export const updatePublicationSchema = createPublicationSchema.omit({
  slug: true,
});
export type UpdatePublicationValues = z.infer<typeof updatePublicationSchema>;

export const setPublicationStatusSchema = z.object({
  status: publicationStatusSchema,
});

export const addDomainSchema = z.object({
  domain: domainSchema,
  isPrimary: z.boolean().optional().default(false),
});
export type AddDomainValues = z.infer<typeof addDomainSchema>;

export const createPublicationStorySchema = z.object({
  storyId: z.string().uuid(),
  slug: slugSchema,
  headline: optionalText(300),
  publishedSummary: optionalText(2000),
  publishedWhyItMatters: optionalText(2000),
  featured: z.boolean().optional().default(false),
  editorialPriority: z.coerce.number().int().min(-1000).max(1000).default(0),
});
export type CreatePublicationStoryValues = z.infer<
  typeof createPublicationStorySchema
>;

/** Edit form: the canonical Story link is immutable; only presentation changes. */
export const updatePublicationStorySchema = createPublicationStorySchema.omit({
  storyId: true,
});
export type UpdatePublicationStoryValues = z.infer<
  typeof updatePublicationStorySchema
>;

export const setPublicationStoryStatusSchema = z.object({
  status: publicationStoryStatusSchema,
});

const optionalTranslationSource = z
  .union([translationSourceSchema, z.literal('')])
  .optional()
  .transform((value) => (value === '' || value === undefined ? null : value));

export const createStoryLocalizationSchema = z.object({
  locale: localeSchema,
  headline: optionalText(300),
  summary: optionalText(2000),
  whyItMatters: optionalText(2000),
  translationSource: optionalTranslationSource,
  modelProvider: optionalText(100),
  modelName: optionalText(100),
});
export type CreateStoryLocalizationValues = z.infer<
  typeof createStoryLocalizationSchema
>;

/** Edit form: locale is the localisation's identity and is immutable. */
export const updateStoryLocalizationSchema = createStoryLocalizationSchema.omit(
  { locale: true },
);
export type UpdateStoryLocalizationValues = z.infer<
  typeof updateStoryLocalizationSchema
>;

export const setStoryLocalizationStatusSchema = z.object({
  status: localizationStatusSchema,
});
