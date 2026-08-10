import type { Db } from '@/db/client';
import { ArticleEnrichmentRepository, ArticleRepository } from '@/domain';
import type {
  ArticleEnrichmentRow,
  ArticleRow,
  SuggestedEntity,
  SuggestedTopic,
} from '@/domain/types';

import { AiProviderError } from '../provider/errors';
import type { AiProvider } from '../provider/types';

import { buildEnrichmentRequest } from './prompt';
import { validateEnrichmentOutput, type EnrichmentOutput } from './schema';

/**
 * Article enrichment service (Stage 6) — the orchestration between source facts,
 * the AI provider, strict validation, and versioned persistence.
 *
 * Guarantees, by construction:
 *  - it NEVER writes to the Article (or any canonical Story/Entity/Topic) — it
 *    only appends to article_enrichments via the versioned repository;
 *  - every attempt (success, invalid output, provider error) is persisted as its
 *    own version, so failures are recorded and prior provenance is preserved;
 *  - provider output is machine-validated against a strict schema before it is
 *    trusted; a malformed reply becomes INVALID_OUTPUT, never a silent success;
 *  - AI output is advisory: nothing here publishes an Article or promotes output
 *    into a canonical field.
 */

/** Thrown when enrichment is requested for a missing Article. */
export class ArticleNotFoundError extends Error {
  constructor(message = 'Article not found.') {
    super(message);
    this.name = 'ArticleNotFoundError';
  }
}

/** Thrown when an Article is not eligible for enrichment (and force is not set). */
export class EnrichmentIneligibleError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'EnrichmentIneligibleError';
  }
}

export interface EnrichArticleOptions {
  maxContentChars?: number;
  maxOutputTokens?: number;
  temperature?: number;
  /** Bypass the eligibility gate (explicit admin override). */
  force?: boolean;
}

export type EnrichmentResult =
  | {
      outcome: 'SUCCEEDED';
      enrichment: ArticleEnrichmentRow;
      output: EnrichmentOutput;
    }
  | {
      outcome: 'INVALID_OUTPUT';
      enrichment: ArticleEnrichmentRow;
      validationError: string;
    }
  | {
      outcome: 'PROVIDER_ERROR';
      enrichment: ArticleEnrichmentRow;
      retryable: boolean;
      errorCode: string;
    };

/**
 * Eligibility gate (cost-control seam). Deliberately conservative: it skips items
 * already removed from the editorial pipeline and items with no usable text.
 * Callers can override with `force`. Pure and side-effect free.
 */
export function isEligibleForEnrichment(article: ArticleRow): {
  eligible: boolean;
  reason?: string;
} {
  if (article.status === 'HIDDEN' || article.status === 'DUPLICATE') {
    return {
      eligible: false,
      reason: `Article status ${article.status} is excluded from enrichment.`,
    };
  }
  const hasText = Boolean(
    (article.original_title && article.original_title.trim()) ||
    (article.original_excerpt && article.original_excerpt.trim()) ||
    (article.clean_text && article.clean_text.trim()),
  );
  if (!hasText) {
    return { eligible: false, reason: 'Article has no text to enrich.' };
  }
  return { eligible: true };
}

/**
 * Enrich one Article. Returns a discriminated result and, in every non-throwing
 * branch, persists exactly one new enrichment version. Throws only for caller
 * errors (missing Article, ineligible without force) — those write nothing.
 */
export async function enrichArticle(
  db: Db,
  provider: AiProvider,
  articleId: string,
  options: EnrichArticleOptions = {},
): Promise<EnrichmentResult> {
  const article = await new ArticleRepository(db).findById(articleId);
  if (!article) throw new ArticleNotFoundError();

  if (!options.force) {
    const eligibility = isEligibleForEnrichment(article);
    if (!eligibility.eligible) {
      throw new EnrichmentIneligibleError(
        eligibility.reason ?? 'Article is not eligible for enrichment.',
      );
    }
  }

  const enrichments = new ArticleEnrichmentRepository(db);
  const { request, promptName, promptVersion, schemaVersion } =
    buildEnrichmentRequest(article, {
      maxContentChars: options.maxContentChars,
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
    });

  // --- Provider call: any failure is classified and recorded, never thrown out.
  let response;
  try {
    response = await provider.completeStructured(request);
  } catch (error) {
    const providerError =
      error instanceof AiProviderError
        ? error
        : new AiProviderError('UNKNOWN', 'Unexpected provider failure.');
    const enrichment = await enrichments.create({
      articleId,
      modelProvider: provider.name,
      modelName: provider.model,
      promptName,
      promptVersion,
      schemaVersion,
      status: 'PROVIDER_ERROR',
      relevance: 'UNCLASSIFIED',
      errorCode: providerError.code,
      errorMessage: providerError.message,
    });
    return {
      outcome: 'PROVIDER_ERROR',
      enrichment,
      retryable: providerError.retryable,
      errorCode: providerError.code,
    };
  }

  // --- Strict validation: a malformed/partial reply is recorded as INVALID.
  const validation = validateEnrichmentOutput(response.parsed);
  if (!validation.ok) {
    const enrichment = await enrichments.create({
      articleId,
      modelProvider: response.provider,
      modelName: response.model,
      promptName,
      promptVersion,
      schemaVersion,
      status: 'INVALID_OUTPUT',
      relevance: 'UNCLASSIFIED',
      validationError: validation.error,
      usage: usageFrom(response.usage),
      // Keep the raw parsed object (when it is one) for debugging/audit.
      structuredOutput: asRecord(response.parsed),
    });
    return {
      outcome: 'INVALID_OUTPUT',
      enrichment,
      validationError: validation.error,
    };
  }

  // --- Success: persist the validated, structured enrichment version.
  const output = validation.value;
  const enrichment = await enrichments.create({
    articleId,
    modelProvider: response.provider,
    modelName: response.model,
    promptName,
    promptVersion,
    schemaVersion,
    status: 'SUCCEEDED',
    relevance: output.relevance,
    relevanceReason: output.relevanceReason,
    summary: output.summary,
    whyItMatters: output.whyItMatters,
    confidence: output.confidence,
    suggestedTopics: output.suggestedTopics.map(toSuggestedTopic),
    suggestedEntities: output.suggestedEntities.map(toSuggestedEntity),
    usage: usageFrom(response.usage),
    structuredOutput: asRecord(response.parsed),
  });
  return { outcome: 'SUCCEEDED', enrichment, output };
}

function toSuggestedTopic(
  t: EnrichmentOutput['suggestedTopics'][number],
): SuggestedTopic {
  return { name: t.name, slug: t.slug, confidence: t.confidence };
}

function toSuggestedEntity(
  e: EnrichmentOutput['suggestedEntities'][number],
): SuggestedEntity {
  return { name: e.name, entity_type: e.type, confidence: e.confidence };
}

function usageFrom(
  usage: { inputTokens?: number; outputTokens?: number } | null,
): { input_tokens?: number; output_tokens?: number } | null {
  if (!usage) return null;
  return {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
