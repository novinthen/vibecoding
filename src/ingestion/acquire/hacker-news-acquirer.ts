import type { SourceRow } from '@/domain/types';

import type { NormalizedItem } from '../adapters/types';
import { IngestError } from '../http/errors';
import {
  parseSourceConfig,
  type HackerNewsSourceConfig,
} from '../source-config';

import type {
  AcquisitionContext,
  AcquisitionResult,
  SourceAcquirer,
} from './types';

/**
 * Hacker News acquirer (Stage 9B).
 *
 * Ingests *story-type* items only from the official Hacker News Firebase API,
 * mapping each into the canonical {@link NormalizedItem} shape so HN flows
 * through the same canonicalization → dedup → Article persistence →
 * SourceFetch/health → enrichment → clustering → ranking pipeline as any other
 * Source.
 *
 * Boundedness and hygiene:
 *  - the list endpoints are fixed (`top|best|new stories`), items fetched by id;
 *  - the number of items is bounded by `maxItems` from Source config;
 *  - the shared safe fetcher enforces SSRF, redirect bounds, timeout, size caps;
 *  - comments, deleted/dead, and malformed items are excluded;
 *  - an external target URL is used when present; a text-only Ask HN uses its HN
 *    discussion URL as the canonical, publicly accessible target;
 *  - a stable `hn:item:{id}` external id dedups re-runs;
 *  - HN score/comment counts are volatile engagement signals and are
 *    deliberately NOT captured onto the Article — they must never influence
 *    Stage 8 ranking, and they would pollute the provider-agnostic Article shape.
 */

const HN_API_BASE = 'https://hacker-news.firebaseio.com/v0';
const HN_ITEM_BASE = 'https://news.ycombinator.com/item?id=';
const HN_TEXT_EXCERPT_MAX = 500;

export const hackerNewsAcquirer: SourceAcquirer = {
  sourceTypes: ['HACKER_NEWS'],

  async acquire(
    source: SourceRow,
    ctx: AcquisitionContext,
  ): Promise<AcquisitionResult> {
    const config = parseSourceConfig(
      'HACKER_NEWS',
      source.source_config,
    ) as HackerNewsSourceConfig;

    const jsonHeaders = { accept: 'application/json' };
    let httpStatus = 200;

    // Resolve the candidate item ids, bounded by maxItems.
    let ids: number[];
    if (config.mode === 'ids') {
      ids = config.ids.slice(0, config.maxItems);
    } else {
      const listUrl = `${HN_API_BASE}/${config.mode}stories.json`;
      const response = await ctx.fetchFeed(listUrl, {
        ...ctx.fetchOptions,
        headers: jsonHeaders,
      });
      httpStatus = response.status;
      ids = parseIdList(response.body ?? '').slice(0, config.maxItems);
    }

    const items: NormalizedItem[] = [];
    for (const id of ids) {
      if (!Number.isInteger(id) || id <= 0) continue;
      let body: string | null;
      try {
        const response = await ctx.fetchFeed(`${HN_API_BASE}/item/${id}.json`, {
          ...ctx.fetchOptions,
          headers: jsonHeaders,
        });
        body = response.body;
      } catch {
        // Isolate a single failed item fetch — one bad item never fails the run.
        continue;
      }
      const item = toStoryItem(body ?? '', source.language ?? null);
      if (item) items.push(item);
    }

    return {
      httpStatus,
      notModified: false,
      items,
      language: source.language ?? null,
      etag: null,
      lastModified: null,
    };
  },
};

/** Parse a Firebase story-id list (array of numbers), or throw MALFORMED_FEED. */
function parseIdList(body: string): number[] {
  if (body.trim().length === 0) {
    throw new IngestError('EMPTY_RESPONSE', 'Empty Hacker News response', {
      retryable: false,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (cause) {
    throw new IngestError(
      'MALFORMED_FEED',
      'Hacker News response is not valid JSON',
      { retryable: false, cause },
    );
  }
  if (!Array.isArray(parsed)) {
    throw new IngestError(
      'MALFORMED_FEED',
      'Hacker News story list was not an array',
      { retryable: false },
    );
  }
  return parsed.filter((n): n is number => typeof n === 'number');
}

/**
 * Map one HN item JSON body into a canonical item. Returns null for anything
 * that is not an ingestable story: non-story types, deleted/dead items, missing
 * items (`null`), and malformed payloads are all excluded.
 */
function toStoryItem(
  body: string,
  language: string | null,
): NormalizedItem | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const item = parsed;

  if (item.type !== 'story') return null;
  if (item.deleted === true || item.dead === true) return null;

  const id = item.id;
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return null;

  const title = typeof item.title === 'string' ? item.title.trim() : '';
  if (title.length === 0) return null;

  // External target where present; otherwise the HN discussion page is the
  // canonical, publicly accessible target (text-only Ask/Show HN posts).
  const externalUrl = typeof item.url === 'string' ? item.url.trim() : '';
  const url = externalUrl.length > 0 ? externalUrl : `${HN_ITEM_BASE}${id}`;

  const time = typeof item.time === 'number' ? item.time : null;
  const publishedAt =
    time !== null && Number.isFinite(time) ? new Date(time * 1000) : null;

  return {
    externalId: `hn:item:${id}`,
    url,
    title,
    excerpt: textExcerpt(item.text),
    author: typeof item.by === 'string' && item.by ? item.by : null,
    publishedAt,
    updatedAt: null,
    imageUrl: null,
    language,
  };
}

/** A bounded, plain-ish excerpt from an Ask/Show HN text body, or null. */
function textExcerpt(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const plain = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length === 0) return null;
  return plain.length > HN_TEXT_EXCERPT_MAX
    ? `${plain.slice(0, HN_TEXT_EXCERPT_MAX).trimEnd()}…`
    : plain;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
