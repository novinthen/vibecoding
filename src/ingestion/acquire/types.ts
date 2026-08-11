import type { SourceType } from '@/domain/enums';
import type { SourceRow } from '@/domain/types';

import type { NormalizedItem, SourceAdapter } from '../adapters/types';
import type { IngestErrorCode } from '../http/errors';
import type { FeedFetcher, FeedFetchOptions } from '../http/fetcher';

/**
 * Source-type acquisition seam (Stage 9B).
 *
 * GitHub Releases and Hacker News are new *inputs*, not new *pipelines*
 * (docs/ARCHITECTURE.md "Source Adapter Boundary"). A {@link SourceAcquirer}
 * owns exactly one concern: turning a Source's wire protocol (an XML feed, the
 * GitHub REST API, the Hacker News Firebase API) into the SINGLE canonical
 * {@link NormalizedItem} shape plus the audit/health metadata the orchestrator
 * already understands. Everything downstream — canonicalization, exact dedup,
 * Article persistence, SourceFetch audit, health, enrichment, clustering,
 * ranking, Stage 9A automation — stays format-agnostic and unchanged.
 *
 * Every acquirer fetches through the shared safe fetcher ({@link FeedFetcher}),
 * so the Stage 3 SSRF guard, redirect bounds, timeout, and size caps apply to
 * every provider identically.
 */

/**
 * One bounded, per-item acquisition FAILURE — an item that could not be fetched
 * (timeout, network, 5xx, rate limit), as opposed to an item that was
 * intentionally excluded (a comment, a dead/deleted item, a malformed payload).
 * The distinction matters for observability: intentional exclusions are healthy;
 * acquisition failures degrade the run to PARTIAL, or to FAILED when every
 * requested item fails. Never contains secrets.
 */
export interface AcquisitionItemFailure {
  /** Provider reference for the item, e.g. `hn:item:123`. */
  ref: string;
  /** Classified failure code (mirrors SourceFetch error codes). */
  code: IngestErrorCode;
  /** Human-readable, secret-free message. */
  message: string;
  /** Whether retrying the same request could plausibly succeed later. */
  retryable: boolean;
}

/**
 * The canonical outcome of acquiring one Source, independent of wire format.
 * Mirrors the fields the orchestrator needs to record a SourceFetch row and
 * update Source health.
 */
export interface AcquisitionResult {
  /** Representative HTTP status for the audit row, or null when not applicable. */
  httpStatus: number | null;
  /** True when a conditional request proved nothing changed (feed/GitHub 304). */
  notModified: boolean;
  /** Canonical items in source order (empty when notModified). */
  items: NormalizedItem[];
  /** Feed/source-level language applied to items that do not declare their own. */
  language: string | null;
  /** ETag validator to persist for the next conditional request, or null. */
  etag: string | null;
  /** Last-Modified validator to persist, or null. */
  lastModified: string | null;
  /**
   * Bounded per-item acquisition failures encountered while assembling `items`
   * (providers that fetch items individually, e.g. Hacker News). Empty/undefined
   * when the provider fetches a single resource whose failure throws instead
   * (e.g. an RSS feed body or a GitHub releases page).
   */
  failures?: AcquisitionItemFailure[];
  /**
   * The number of distinct items the provider ATTEMPTED to acquire (e.g. the
   * count of Hacker News ids requested), when meaningful. Lets the orchestrator
   * tell "healthy but nothing relevant" from "everything failed".
   */
  attempted?: number;
}

/** Cross-cutting dependencies every acquirer shares. */
export interface AcquisitionContext {
  /** Shared safe fetcher (SSRF, redirects, timeout, size caps). */
  fetchFeed: FeedFetcher;
  /** Feed format adapter (used only by the RSS/Atom acquirer). */
  adapter: SourceAdapter;
  /** Extra fetch options (timeouts, limits, resolver, injected fetch). */
  fetchOptions?: FeedFetchOptions;
  /** Clock seam for deterministic timing in tests. */
  now: () => Date;
  /**
   * Optional server-only GitHub token. `undefined` means "resolve from the
   * environment"; `null` forces an unauthenticated request. Never stored in
   * Source config and never logged.
   */
  githubToken?: string | null;
}

/** A provider-specific acquirer. Implementations must not persist anything. */
export interface SourceAcquirer {
  /** SourceType(s) this acquirer serves. */
  readonly sourceTypes: readonly SourceType[];
  /** Acquire canonical items for one Source. May throw {@link import('../http/errors').IngestError}. */
  acquire(
    source: SourceRow,
    ctx: AcquisitionContext,
  ): Promise<AcquisitionResult>;
}
