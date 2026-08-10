import { createHash } from 'node:crypto';

import type { ArticleRow } from '@/domain/types';

/**
 * Assemble the text an Article is embedded from, and hash it for staleness.
 *
 * Only SOURCE-supplied fields are used (title + excerpt + a bounded slice of
 * clean text). This reads Article facts but never writes them — the resulting
 * embedding is stored as derived data in `article_embeddings`, never back onto
 * the Article (provenance rule). The `source_content_hash` lets the pipeline
 * detect when the underlying text changed and a re-embed is warranted, without
 * keeping the full text alongside the vector.
 */

/** Upper bound on embedded characters — keeps embedding cost/text bounded. */
export const MAX_EMBEDDING_CHARS = 4000;

export function articleEmbeddingText(
  article: Pick<
    ArticleRow,
    'original_title' | 'normalized_title' | 'original_excerpt' | 'clean_text'
  >,
  maxChars: number = MAX_EMBEDDING_CHARS,
): string {
  const title = (article.normalized_title || article.original_title || '')
    .replace(/\s+/g, ' ')
    .trim();
  const excerpt = (article.original_excerpt ?? '').replace(/\s+/g, ' ').trim();
  const body = (article.clean_text ?? '').replace(/\s+/g, ' ').trim();
  // Title is repeated once so it carries extra weight in the bag-of-tokens
  // embedding — headlines are the strongest same-event signal.
  const combined = [title, title, excerpt, body]
    .filter((part) => part.length > 0)
    .join('\n');
  return combined.slice(0, Math.max(0, maxChars));
}

/** Stable SHA-256 hex digest of the exact text that was embedded. */
export function embeddingContentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
