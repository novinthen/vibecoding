import { describe, expect, it } from 'vitest';

import { FakeEmbeddingProvider } from '@/clustering/embedding/fake-provider';
import { cosineSimilarity } from '@/clustering/scoring';
import {
  articleEmbeddingText,
  embeddingContentHash,
} from '@/clustering/embedding/text';
import type { ArticleRow } from '@/domain/types';

/**
 * Fake embedding provider unit tests. The provider must be deterministic and
 * similarity-preserving so that required CI never depends on a live embeddings
 * API and clustering results are reproducible.
 */

function article(overrides: Partial<ArticleRow>): ArticleRow {
  return {
    id: 'a',
    source_id: 's',
    external_id: null,
    url: 'https://example.com/a',
    canonical_url: null,
    url_hash: null,
    original_title: 'Title',
    normalized_title: null,
    original_excerpt: null,
    clean_text: null,
    author: null,
    published_at: null,
    source_updated_at: null,
    discovered_at: '2026-01-01T00:00:00.000Z',
    image_url: null,
    language: null,
    content_hash: null,
    status: 'DISCOVERED',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('FakeEmbeddingProvider', () => {
  const provider = new FakeEmbeddingProvider();

  it('exposes provenance and fixed dimensions', () => {
    expect(provider.name).toBe('fake');
    expect(provider.version).toBe(1);
    expect(provider.dimensions).toBe(64);
    expect(provider.model).toContain('fake-embed');
  });

  it('is deterministic: equal text yields the identical vector', async () => {
    const a = await provider.embed('Anthropic ships a new Claude Code feature');
    const b = await provider.embed('Anthropic ships a new Claude Code feature');
    expect(a).toEqual(b);
    expect(a).toHaveLength(64);
  });

  it('returns L2-normalised vectors', async () => {
    const v = await provider.embed('some coding agent news about tooling');
    const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it('scores near-identical text high and unrelated text low', async () => {
    const base = await provider.embed(
      'Anthropic launches a new Claude Code capability for developers',
    );
    const near = await provider.embed(
      'Anthropic launches a new Claude Code capability for developers today',
    );
    const unrelated = await provider.embed(
      'Stock markets fell sharply amid concerns over interest rates',
    );
    expect(cosineSimilarity(base, near)).toBeGreaterThan(0.85);
    expect(cosineSimilarity(base, unrelated)).toBeLessThan(0.3);
  });

  it('handles empty/tokenless text without producing NaNs', async () => {
    const v = await provider.embed('   ');
    expect(v).toHaveLength(64);
    expect(v.every((x) => Number.isFinite(x))).toBe(true);
  });
});

describe('articleEmbeddingText', () => {
  it('combines source fields and repeats the title for weight', () => {
    const text = articleEmbeddingText(
      article({
        original_title: 'Claude Code ships',
        original_excerpt: 'A new feature landed.',
      }),
    );
    // Title appears twice (weighting), excerpt once.
    expect(text.match(/Claude Code ships/g)).toHaveLength(2);
    expect(text).toContain('A new feature landed.');
  });

  it('prefers normalized_title when present and bounds length', () => {
    const long = 'x'.repeat(10000);
    const text = articleEmbeddingText(
      article({ normalized_title: 'Norm', clean_text: long }),
      100,
    );
    expect(text.startsWith('Norm')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(100);
  });

  it('hashes identical text identically and different text differently', () => {
    expect(embeddingContentHash('same')).toBe(embeddingContentHash('same'));
    expect(embeddingContentHash('a')).not.toBe(embeddingContentHash('b'));
  });
});
