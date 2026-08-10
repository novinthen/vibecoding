import { z } from 'zod';

import {
  articleStatusSchema,
  authorityTierSchema,
  sourceTypeSchema,
} from '@/domain/enums';

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
