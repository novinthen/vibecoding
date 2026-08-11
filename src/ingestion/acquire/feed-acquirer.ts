import type { SourceRow } from '@/domain/types';

import { IngestError } from '../http/errors';

import type {
  AcquisitionContext,
  AcquisitionResult,
  SourceAcquirer,
} from './types';

/**
 * RSS/Atom acquirer.
 *
 * The original Stage 3 acquisition path, unchanged in behaviour: fetch the
 * Source's `feed_url` through the safe fetcher (honouring stored ETag/
 * Last-Modified conditional requests), short-circuit on a 304, otherwise parse
 * the payload into canonical items with the format adapter. It is also the
 * default acquirer for any Source type without a dedicated one, preserving the
 * pre-9B behaviour for RSS, ATOM, RSSHUB, API, and MANUAL.
 */
export const feedAcquirer: SourceAcquirer = {
  sourceTypes: ['RSS', 'ATOM', 'RSSHUB'],

  async acquire(
    source: SourceRow,
    ctx: AcquisitionContext,
  ): Promise<AcquisitionResult> {
    if (!source.feed_url) {
      throw new IngestError(
        'INVALID_URL',
        'Source has no feed_url configured',
        { retryable: false },
      );
    }

    const response = await ctx.fetchFeed(source.feed_url, {
      etag: source.etag,
      lastModified: source.last_modified,
      ...ctx.fetchOptions,
    });

    if (response.notModified) {
      return {
        httpStatus: response.status,
        notModified: true,
        items: [],
        language: null,
        etag: response.etag ?? null,
        lastModified: response.lastModified ?? null,
      };
    }

    const parsed = ctx.adapter.parse({
      body: response.body ?? '',
      contentType: response.contentType,
    });

    return {
      httpStatus: response.status,
      notModified: false,
      items: parsed.items,
      language: parsed.language,
      etag: response.etag ?? null,
      lastModified: response.lastModified ?? null,
    };
  },
};
