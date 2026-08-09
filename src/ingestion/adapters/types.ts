import type { SourceType } from '@/domain/enums';

/**
 * Source Adapter contract.
 *
 * The rest of the application does not care whether an item arrived via RSS,
 * Atom, an API, or a community endpoint (docs/ARCHITECTURE.md "Source Adapter
 * Boundary"). Every adapter maps its wire format into ONE canonical ingestion
 * shape — {@link NormalizedItem} — so downstream normalization, canonicalization,
 * deduplication, and persistence stay format-agnostic.
 *
 * The conceptual contract from the architecture doc is `validate / fetch /
 * normalize / healthCheck`. Here it is split into two seams:
 *  - {@link SourceAdapter} owns format concerns: which raw bytes it accepts
 *    (`supports`), and how to turn them into {@link NormalizedItem}s (`parse`).
 *  - HTTP `fetch` and Source `healthCheck` are cross-cutting and live in the
 *    fetcher and health modules respectively, shared by every adapter, so each
 *    adapter is a small pure transform that is trivial to test with fixtures.
 */

/** The single canonical shape every adapter must emit per feed item. */
export interface NormalizedItem {
  /**
   * Stable per-Source identifier from the feed (RSS `guid` / Atom `id`), if any.
   * Used as the first-choice exact-dedup key before falling back to URL hash.
   */
  externalId: string | null;
  /** Absolute item link as supplied by the source (untrusted, http(s) only). */
  url: string;
  /** Human-readable title (required; items without one are dropped upstream). */
  title: string;
  /** Short source-supplied summary/excerpt, plain-ish text, or null. */
  excerpt: string | null;
  /** Best-effort author/byline, or null. */
  author: string | null;
  /** Source publication timestamp (UTC), or null when unparseable/absent. */
  publishedAt: Date | null;
  /** Source last-updated timestamp (UTC), or null. */
  updatedAt: Date | null;
  /** Representative image URL, or null. */
  imageUrl: string | null;
  /** BCP-47-ish language tag declared by the feed, or null. */
  language: string | null;
}

/** Result of parsing a raw feed payload into canonical items. */
export interface ParsedFeed {
  /** Feed-level title, when present. */
  title: string | null;
  /** Feed-level language, applied to items that do not declare their own. */
  language: string | null;
  /** Canonical items in feed order. */
  items: NormalizedItem[];
}

/** Minimal payload an adapter needs to decide support and parse. */
export interface RawFeedPayload {
  body: string;
  contentType: string | null;
}

/**
 * A format adapter: recognises whether it can handle a payload and parses it
 * into canonical items. Implementations must be pure and side-effect free.
 */
export interface SourceAdapter {
  /** SourceType(s) this adapter serves (e.g. RSS, ATOM). */
  readonly sourceTypes: readonly SourceType[];
  /** Stable adapter name for logs and audit metadata. */
  readonly name: string;
  /** True if this adapter can parse the given raw payload. */
  supports(payload: RawFeedPayload): boolean;
  /**
   * Parse the payload into a {@link ParsedFeed}. Throws an
   * {@link import('../http/errors').IngestError} with code `MALFORMED_FEED` when
   * the payload is not valid for this format.
   */
  parse(payload: RawFeedPayload): ParsedFeed;
}
