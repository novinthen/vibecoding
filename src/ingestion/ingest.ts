import type {
  CompleteFetchInput,
  CreateArticleInput,
  SourceFetchStatus,
  UpdateFetchStateInput,
} from '@/domain';
import type { ArticleRow, SourceFetchRow, SourceRow } from '@/domain/types';

import { feedAdapter } from './adapters/feed-adapter';
import type { SourceAdapter } from './adapters/types';
import {
  IngestError,
  type IngestErrorCode,
  toIngestError,
} from './http/errors';
import { fetchFeed as defaultFetchFeed } from './http/fetcher';
import type { FeedFetchOptions, FeedResponse } from './http/fetcher';
import { deriveHealth } from './health';
import { CanonicalUrlError } from './normalize/canonical-url';
import { toArticleInput } from './normalize/normalize';

/**
 * Ingestion orchestrator.
 *
 * Runs the Stage 3 pipeline for a single Source:
 *
 *   fetch → parse → normalize → canonicalize → exact dedup → Article persistence
 *         → SourceFetch audit → Source health
 *
 * The orchestrator depends only on the small repository-shaped and fetcher
 * interfaces below, so it is exercised deterministically with fixtures and
 * in-memory fakes in unit tests, and against real Postgres in integration tests.
 *
 * Guarantees:
 *  - every attempt opens and closes exactly one SourceFetch audit row, even on
 *    failure, so a broken Source stays observable;
 *  - a single unusable item is dropped (counted), never aborting the feed;
 *  - insertion is idempotent (createIfAbsent), so re-ingesting the same feed
 *    creates no duplicate Articles;
 *  - one Source's failure is fully contained — {@link ingestSources} isolates it.
 */

/** Article persistence surface the orchestrator needs (satisfied by ArticleRepository). */
export interface ArticleWriter {
  createIfAbsent(input: CreateArticleInput): Promise<ArticleRow | null>;
}

/** SourceFetch audit surface (satisfied by SourceFetchRepository). */
export interface SourceFetchWriter {
  start(sourceId: string): Promise<SourceFetchRow>;
  complete(id: string, input: CompleteFetchInput): Promise<void>;
}

/** Source health surface (satisfied by SourceRepository). */
export interface SourceHealthWriter {
  updateFetchState(id: string, input: UpdateFetchStateInput): Promise<void>;
}

/** Feed fetcher seam (satisfied by {@link fetchFeed}). */
export type FeedFetcher = (
  url: string,
  options: FeedFetchOptions,
) => Promise<FeedResponse>;

export interface IngestDeps {
  articles: ArticleWriter;
  sourceFetches: SourceFetchWriter;
  sources: SourceHealthWriter;
  /** Defaults to the real safe HTTP fetcher. */
  fetchFeed?: FeedFetcher;
  /** Defaults to the RSS/Atom adapter. */
  adapter?: SourceAdapter;
  /** Clock seam for deterministic timing in tests. */
  now?: () => Date;
  /** Extra fetch options (timeouts, limits, resolver, injected fetch). */
  fetchOptions?: FeedFetchOptions;
}

export interface IngestResult {
  sourceId: string;
  status: SourceFetchStatus;
  httpStatus: number | null;
  itemsFound: number;
  itemsNew: number;
  itemsExisting: number;
  itemsSkipped: number;
  durationMs: number;
  notModified: boolean;
  errorCode: IngestErrorCode | null;
  errorMessage: string | null;
}

/** Ingest one Source through the full pipeline. Never throws for expected
 * fetch/parse failures — those are recorded and returned in the result. */
export async function ingestSource(
  source: SourceRow,
  deps: IngestDeps,
): Promise<IngestResult> {
  const now = deps.now ?? (() => new Date());
  const fetchImpl = deps.fetchFeed ?? defaultFetchFeed;
  const adapter = deps.adapter ?? feedAdapter;
  const startedMs = now().getTime();

  const fetchRow = await deps.sourceFetches.start(source.id);

  try {
    if (!source.feed_url) {
      throw new IngestError(
        'INVALID_URL',
        'Source has no feed_url configured',
        {
          retryable: false,
        },
      );
    }

    const response = await fetchImpl(source.feed_url, {
      etag: source.etag,
      lastModified: source.last_modified,
      ...deps.fetchOptions,
    });

    const completedAt = now();
    const durationMs = completedAt.getTime() - startedMs;

    if (response.notModified) {
      await applyHealth(deps.sources, source, 'success', completedAt, {
        etag: response.etag ?? undefined,
        lastModified: response.lastModified ?? undefined,
      });
      await deps.sourceFetches.complete(fetchRow.id, {
        status: 'SKIPPED',
        httpStatus: response.status,
        itemsFound: 0,
        itemsNew: 0,
        itemsUpdated: 0,
        durationMs,
        metadata: { notModified: true },
      });
      return result(source.id, 'SKIPPED', response.status, {
        durationMs,
        notModified: true,
      });
    }

    const parsed = adapter.parse({
      body: response.body ?? '',
      contentType: response.contentType,
    });

    let itemsNew = 0;
    let itemsExisting = 0;
    let itemsSkipped = 0;

    for (const item of parsed.items) {
      let input: CreateArticleInput;
      try {
        input = toArticleInput(source.id, item, {
          defaultLanguage: parsed.language,
        });
      } catch (error) {
        // A single un-canonicalizable URL drops the item, not the feed.
        if (error instanceof CanonicalUrlError) {
          itemsSkipped += 1;
          continue;
        }
        throw error;
      }
      const created = await deps.articles.createIfAbsent(input);
      if (created) itemsNew += 1;
      else itemsExisting += 1;
    }

    const itemsFound = parsed.items.length;
    // All present items failed to normalize → PARTIAL; otherwise SUCCESS.
    const status: SourceFetchStatus =
      itemsFound > 0 && itemsSkipped === itemsFound ? 'PARTIAL' : 'SUCCESS';

    await applyHealth(deps.sources, source, 'success', completedAt, {
      etag: response.etag ?? undefined,
      lastModified: response.lastModified ?? undefined,
    });
    await deps.sourceFetches.complete(fetchRow.id, {
      status,
      httpStatus: response.status,
      itemsFound,
      itemsNew,
      itemsUpdated: 0,
      durationMs,
      metadata: { itemsExisting, itemsSkipped },
    });

    return {
      sourceId: source.id,
      status,
      httpStatus: response.status,
      itemsFound,
      itemsNew,
      itemsExisting,
      itemsSkipped,
      durationMs,
      notModified: false,
      errorCode: null,
      errorMessage: null,
    };
  } catch (error) {
    const ingestError = toIngestError(error);
    const completedAt = now();
    const durationMs = completedAt.getTime() - startedMs;

    // Failure degrades health but never touches success/validator state.
    await applyHealth(deps.sources, source, 'failure', completedAt, {});
    await deps.sourceFetches.complete(fetchRow.id, {
      status: 'FAILED',
      httpStatus: ingestError.httpStatus,
      durationMs,
      errorCode: ingestError.code,
      errorMessage: ingestError.message,
      metadata: { retryable: ingestError.retryable },
    });

    return {
      sourceId: source.id,
      status: 'FAILED',
      httpStatus: ingestError.httpStatus,
      itemsFound: 0,
      itemsNew: 0,
      itemsExisting: 0,
      itemsSkipped: 0,
      durationMs,
      notModified: false,
      errorCode: ingestError.code,
      errorMessage: ingestError.message,
    };
  }
}

/**
 * Ingest many Sources, isolating each so one slow/failing Source cannot corrupt
 * another. Runs sequentially to keep per-Source rate control simple and avoid
 * hammering upstreams; ordering is stable for reproducible runs.
 */
export async function ingestSources(
  sources: readonly SourceRow[],
  deps: IngestDeps,
): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  for (const source of sources) {
    results.push(await ingestSource(source, deps));
  }
  return results;
}

async function applyHealth(
  sources: SourceHealthWriter,
  source: SourceRow,
  outcome: 'success' | 'failure',
  at: Date,
  validators: { etag?: string; lastModified?: string },
): Promise<void> {
  const next = deriveHealth(
    { failureCount: source.failure_count, healthStatus: source.health_status },
    outcome,
  );
  await sources.updateFetchState(source.id, {
    failureCount: next.failureCount,
    healthStatus: next.healthStatus,
    lastFetchAt: at,
    lastSuccessAt: outcome === 'success' ? at : undefined,
    etag: validators.etag,
    lastModified: validators.lastModified,
  });
}

function result(
  sourceId: string,
  status: SourceFetchStatus,
  httpStatus: number | null,
  extra: { durationMs: number; notModified: boolean },
): IngestResult {
  return {
    sourceId,
    status,
    httpStatus,
    itemsFound: 0,
    itemsNew: 0,
    itemsExisting: 0,
    itemsSkipped: 0,
    durationMs: extra.durationMs,
    notModified: extra.notModified,
    errorCode: null,
    errorMessage: null,
  };
}
