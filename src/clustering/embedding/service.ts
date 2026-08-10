import type { Db } from '@/db/client';
import { ArticleEmbeddingRepository } from '@/domain';
import type { ArticleEmbeddingRow, ArticleRow } from '@/domain/types';

import { parseVector } from '../candidates';

import type { EmbeddingProvider } from './types';
import { articleEmbeddingText, embeddingContentHash } from './text';

/**
 * Ensure an Article has a current embedding for the given provider, computing and
 * persisting one only when needed (Stage 7).
 *
 * Idempotent and provenance-preserving: if a stored embedding already matches the
 * provider's model/version AND the exact source text (by content hash), it is
 * reused unchanged. Otherwise the provider is called and the row is upserted with
 * fresh provenance. Embeddings are DERIVED data — this writes only to
 * `article_embeddings`, never to the Article itself.
 */
export interface EnsureEmbeddingResult {
  row: ArticleEmbeddingRow;
  vector: number[];
  /** True when the provider was called (a new/refreshed vector was computed). */
  computed: boolean;
}

export async function ensureArticleEmbedding(
  db: Db,
  provider: EmbeddingProvider,
  article: ArticleRow,
): Promise<EnsureEmbeddingResult> {
  const repo = new ArticleEmbeddingRepository(db);
  const text = articleEmbeddingText(article);
  const hash = embeddingContentHash(text);

  const existing = await repo.findByArticleAndModel(article.id, provider.model);
  if (
    existing &&
    existing.embedding_version === provider.version &&
    existing.source_content_hash === hash
  ) {
    return {
      row: existing,
      vector: parseVector(existing.embedding),
      computed: false,
    };
  }

  const vector = await provider.embed(text);
  const row = await repo.upsert(article.id, {
    provider: provider.name,
    model: provider.model,
    version: provider.version,
    dimensions: provider.dimensions,
    embedding: vector,
    sourceContentHash: hash,
  });
  return { row, vector, computed: true };
}
