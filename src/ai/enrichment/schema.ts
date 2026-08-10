import { z } from 'zod';

import { entityTypeSchema, modelRelevanceSchema } from '@/domain/enums';

/**
 * Strict schema for AI enrichment output (Stage 6).
 *
 * Every field the model returns is validated here BEFORE anything is persisted or
 * trusted. The object is `.strict()`, so unknown keys are rejected rather than
 * silently accepted — a partial or malformed reply fails validation and is
 * recorded as INVALID_OUTPUT, never mistaken for a real enrichment. This is the
 * machine-validation gate the architecture requires between raw provider output
 * and structured domain data.
 */

export const ENRICHMENT_SCHEMA_VERSION = 'enrichment-v1';
export const ENRICHMENT_PROMPT_NAME = 'article-enrichment';
export const ENRICHMENT_PROMPT_VERSION = 'v1';

const confidence = z.number().min(0).max(1);

/**
 * A suggested Topic candidate. `slug` is the model's guess and is optional; the
 * deterministic matching layer — not this schema — decides canonical identity.
 * Bounded lengths keep a hostile reply from ballooning storage.
 */
const suggestedTopicSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((value) => (value ? value : null)),
    confidence: confidence.optional().transform((v) => v ?? null),
  })
  .strict();

const suggestedEntitySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    // The model may omit or guess a type; an invalid type is rejected by the enum
    // only when present. Missing/blank becomes null (unknown), never a default.
    type: z
      .union([entityTypeSchema, z.literal('')])
      .optional()
      .transform((value) => (value ? value : null)),
    confidence: confidence.optional().transform((v) => v ?? null),
  })
  .strict();

/**
 * The full structured enrichment result. Text fields are bounded. `relevance`
 * uses the model-permitted values only (RELEVANT / MAYBE_RELEVANT / IRRELEVANT);
 * the system assigns UNCLASSIFIED on failure — the model can never claim it.
 */
export const enrichmentOutputSchema = z
  .object({
    relevance: modelRelevanceSchema,
    relevanceReason: z.string().trim().min(1).max(1000),
    summary: z.string().trim().min(1).max(2000),
    whyItMatters: z.string().trim().min(1).max(2000),
    suggestedTopics: z.array(suggestedTopicSchema).max(20).default([]),
    suggestedEntities: z.array(suggestedEntitySchema).max(30).default([]),
    confidence,
  })
  .strict();

export type EnrichmentOutput = z.infer<typeof enrichmentOutputSchema>;

/** Result of validating raw provider output against the strict schema. */
export type EnrichmentValidation =
  { ok: true; value: EnrichmentOutput } | { ok: false; error: string };

/**
 * Validate unknown provider output. Never throws: returns a discriminated result
 * so the caller can persist an INVALID_OUTPUT record with a tidy error string
 * instead of crashing. The message is a compact summary of the Zod issues — safe
 * to store and show to an editor (it describes shape, not secrets).
 */
export function validateEnrichmentOutput(raw: unknown): EnrichmentValidation {
  const result = enrichmentOutputSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  const error = result.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  return { ok: false, error: error.slice(0, 1000) };
}
