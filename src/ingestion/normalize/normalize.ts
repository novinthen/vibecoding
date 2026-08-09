import type { CreateArticleInput } from '@/domain/repositories/article-repository';

import type { NormalizedItem } from '../adapters/types';

import { canonicalizeUrl } from './canonical-url';
import { contentHash, urlHash } from './hash';

/**
 * Turn one canonical feed item into a persistable Article draft.
 *
 * This is the single seam where a {@link NormalizedItem} (already format-agnostic)
 * becomes an {@link CreateArticleInput}: the URL is canonicalized and hashed for
 * exact deduplication, and a content hash is computed over the source-supplied
 * text. Only source facts are written — no AI-derived fields — honouring the
 * provenance rule. Throws (via {@link canonicalizeUrl}) when the item URL cannot
 * be canonicalized, which the orchestrator treats as a single dropped item.
 */

export interface NormalizeOptions {
  /** Feed-level language applied when the item does not declare its own. */
  defaultLanguage?: string | null;
}

export function toArticleInput(
  sourceId: string,
  item: NormalizedItem,
  options: NormalizeOptions = {},
): CreateArticleInput {
  const canonical = canonicalizeUrl(item.url);
  const title = item.title.replace(/\s+/g, ' ').trim();

  return {
    sourceId,
    url: item.url,
    canonicalUrl: canonical,
    urlHash: urlHash(canonical),
    originalTitle: title,
    externalId: item.externalId,
    originalExcerpt: item.excerpt,
    author: item.author,
    publishedAt: item.publishedAt,
    sourceUpdatedAt: item.updatedAt,
    imageUrl: item.imageUrl,
    language: item.language ?? options.defaultLanguage ?? null,
    contentHash: contentHash({ title, excerpt: item.excerpt }),
  };
}
