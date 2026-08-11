import type {
  CompleteFetchInput,
  CreateArticleInput,
  SourceFetchStatus,
  UpdateFetchStateInput,
} from '@/domain';
import type { ArticleRow, SourceFetchRow, SourceRow } from '@/domain/types';

import { acquireForSource } from './acquire';
import { feedAdapter } from './adapters/feed-adapter';
import type { SourceAdapter } from './adapters/types';
import { type IngestErrorCode, toIngestError } from './http/errors';
import { fetchFeed as defaultFetchFeed } from './http/fetcher';
import type { FeedFetcher, FeedFetchOptions } from './http/fetcher';
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

export interface IngestDeps {
  articles: ArticleWriter;
  sourceFetches: SourceFetchWriter;
  sources: SourceHealthWriter;
  /** Defaults to the real safe HTTP fetcher. */
  fetchFeed?: FeedFetcher;
  /** Defaults to the RSS/Atom adapter (used only by the feed acquirer). */
  adapter?: SourceAdapter;
  /** Clock seam for deterministic timing in tests. */
  now?: () => Date;
  /** Extra fetch options (timeouts, limits, resolver, injected fetch). */
  fetchOptions?: FeedFetchOptions;
  /**
   * Optional server-only GitHub token override (Stage 9B). `undefined` resolves
   * from the environment; `null` forces an unauthenticated request. Injected in
   * tests; nothing is overridden in production.
   */
  githubToken?: string | null;
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
  const startedMs = now().getTime();

  const fetchRow = await deps.sourceFetches.start(source.id);

  try {
    // Source-type dispatch: RSS/Atom, GitHub Releases, or Hacker News all reduce
    // to the same canonical acquisition result. Everything below this line is
    // format-agnostic and shared by every Source type.
    const acquired = await acquireForSource(source, {
      fetchFeed: deps.fetchFeed ?? defaultFetchFeed,
      adapter: deps.adapter ?? feedAdapter,
      fetchOptions: deps.fetchOptions,
      now,
      githubToken: deps.githubToken,
    });

    const completedAt = now();
    const durationMs = completedAt.getTime() - startedMs;

    if (acquired.notModified) {
      await applyHealth(deps.sources, source, 'success', completedAt, {
        etag: acquired.etag ?? undefined,
        lastModified: acquired.lastModified ?? undefined,
      });
      await deps.sourceFetches.complete(fetchRow.id, {
        status: 'SKIPPED',
        httpStatus: acquired.httpStatus,
        itemsFound: 0,
        itemsNew: 0,
        itemsUpdated: 0,
        durationMs,
        metadata: { notModified: true },
      });
      return result(source.id, 'SKIPPED', acquired.httpStatus, {
        durationMs,
        notModified: true,
      });
    }

    let itemsNew = 0;
    let itemsExisting = 0;
    let itemsSkipped = 0;

    for (const item of acquired.items) {
      let input: CreateArticleInput;
      try {
        input = toArticleInput(source.id, item, {
          defaultLanguage: acquired.language,
        });
      } catch (error) {
        // A single un-canonicalizable URL drops the item, not the whole Source.
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

    const itemsFound = acquired.items.length;
    // All present items failed to normalize → PARTIAL; otherwise SUCCESS.
    const status: SourceFetchStatus =
      itemsFound > 0 && itemsSkipped === itemsFound ? 'PARTIAL' : 'SUCCESS';

    await applyHealth(deps.sources, source, 'success', completedAt, {
      etag: acquired.etag ?? undefined,
      lastModified: acquired.lastModified ?? undefined,
    });
    await deps.sourceFetches.complete(fetchRow.id, {
      status,
      httpStatus: acquired.httpStatus,
      itemsFound,
      itemsNew,
      itemsUpdated: 0,
      durationMs,
      metadata: { itemsExisting, itemsSkipped },
    });

    return {
      sourceId: source.id,
      status,
      httpStatus: acquired.httpStatus,
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
