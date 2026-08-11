import type { SourceType } from '@/domain/enums';
import type { SourceRow } from '@/domain/types';

import type { NormalizedItem, SourceAdapter } from '../adapters/types';
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
