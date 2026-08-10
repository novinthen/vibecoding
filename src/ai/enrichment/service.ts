import type { Pool } from 'pg';

import { getPool, type Db } from '@/db/client';
import { ArticleEnrichmentRepository, ArticleRepository } from '@/domain';
import type { CreateEnrichmentInput } from '@/domain';
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

/** Injectable dependencies for the enrichment service. */
export interface EnrichArticleDeps {
  /** Pool for reads and for the owned persistence transaction (default: shared). */
  pool?: Pool;
  /**
   * Extra work to run INSIDE the same short transaction that allocates the
   * version and inserts the enrichment (e.g. the admin audit write). It sees the
   * persisted row and commits atomically with it. Must do no network I/O.
   */
  onPersist?: (tx: Db, enrichment: ArticleEnrichmentRow) => Promise<void>;
}

/**
 * Enrich one Article via the normal public path — the caller needs NO transaction
 * handling.
 *
 * Ordering is deliberate and structural:
 *  1. read the Article and check eligibility (autocommit read);
 *  2. call the AI provider and validate its output — with NO database transaction
 *     open, so a slow/stalled provider never holds a DB lock;
 *  3. persist exactly one new version inside the repository's OWN short
 *     transaction (advisory-locked allocation + insert), optionally running
 *     `deps.onPersist` in that same transaction.
 *
 * Every non-throwing branch (success, invalid output, provider error) persists a
 * versioned row through the same concurrency-safe path. Throws only for caller
 * errors (missing Article, ineligible without force) — those write nothing.
 */
export async function enrichArticle(
  provider: AiProvider,
  articleId: string,
  options: EnrichArticleOptions = {},
  deps: EnrichArticleDeps = {},
): Promise<EnrichmentResult> {
  const pool = deps.pool ?? getPool();

  const article = await new ArticleRepository(pool).findById(articleId);
  if (!article) throw new ArticleNotFoundError();

  if (!options.force) {
    const eligibility = isEligibleForEnrichment(article);
    if (!eligibility.eligible) {
      throw new EnrichmentIneligibleError(
        eligibility.reason ?? 'Article is not eligible for enrichment.',
      );
    }
  }

  // Provider call + validation happen OUTSIDE any transaction.
  const prepared = await prepareEnrichment(article, provider, options);

  // Persist through the repository's owned, concurrency-safe transaction.
  const enrichment = await new ArticleEnrichmentRepository(
    pool,
  ).createVersioned(prepared.input, { pool, withinTx: deps.onPersist });

  switch (prepared.kind) {
    case 'SUCCEEDED':
      return { outcome: 'SUCCEEDED', enrichment, output: prepared.output };
    case 'INVALID_OUTPUT':
      return {
        outcome: 'INVALID_OUTPUT',
        enrichment,
        validationError: prepared.validationError,
      };
    case 'PROVIDER_ERROR':
      return {
        outcome: 'PROVIDER_ERROR',
        enrichment,
        retryable: prepared.retryable,
        errorCode: prepared.errorCode,
      };
  }
}

/** Outcome of the provider+validation step, plus the row to persist. No DB I/O. */
type PreparedEnrichment =
  | {
      kind: 'SUCCEEDED';
      input: CreateEnrichmentInput;
      output: EnrichmentOutput;
    }
  | {
      kind: 'INVALID_OUTPUT';
      input: CreateEnrichmentInput;
      validationError: string;
    }
  | {
      kind: 'PROVIDER_ERROR';
      input: CreateEnrichmentInput;
      retryable: boolean;
      errorCode: string;
    };

/**
 * Run the AI provider and validate its output, producing the enrichment row to
 * persist. Performs the network call and strict validation but touches no
 * database — persistence is a separate, short, transactional step. A provider
 * failure or invalid output becomes a PROVIDER_ERROR / INVALID_OUTPUT row rather
 * than throwing, so every attempt is recorded through the same path.
 */
async function prepareEnrichment(
  article: ArticleRow,
  provider: AiProvider,
  options: EnrichArticleOptions,
): Promise<PreparedEnrichment> {
  const { request, promptName, promptVersion, schemaVersion } =
    buildEnrichmentRequest(article, {
      maxContentChars: options.maxContentChars,
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
    });
  const provenance = {
    articleId: article.id,
    promptName,
    promptVersion,
    schemaVersion,
  };

  let response;
  try {
    response = await provider.completeStructured(request);
  } catch (error) {
    const providerError =
      error instanceof AiProviderError
        ? error
        : new AiProviderError('UNKNOWN', 'Unexpected provider failure.');
    return {
      kind: 'PROVIDER_ERROR',
      retryable: providerError.retryable,
      errorCode: providerError.code,
      input: {
        ...provenance,
        modelProvider: provider.name,
        modelName: provider.model,
        status: 'PROVIDER_ERROR',
        relevance: 'UNCLASSIFIED',
        errorCode: providerError.code,
        errorMessage: providerError.message,
      },
    };
  }

  const validation = validateEnrichmentOutput(response.parsed);
  if (!validation.ok) {
    return {
      kind: 'INVALID_OUTPUT',
      validationError: validation.error,
      input: {
        ...provenance,
        modelProvider: response.provider,
        modelName: response.model,
        status: 'INVALID_OUTPUT',
        relevance: 'UNCLASSIFIED',
        validationError: validation.error,
        usage: usageFrom(response.usage),
        // Keep the raw parsed object (when it is one) for debugging/audit.
        structuredOutput: asRecord(response.parsed),
      },
    };
  }

  const output = validation.value;
  return {
    kind: 'SUCCEEDED',
    output,
    input: {
      ...provenance,
      modelProvider: response.provider,
      modelName: response.model,
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
    },
  };
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
