import { tokenize } from '../tokens';

import type { EmbeddingProvider } from './types';

/**
 * Deterministic, dependency-free embedding provider for CI, tests, and local
 * smoke (Stage 7). It performs NO network I/O, so required CI never depends on a
 * live embeddings API.
 *
 * It uses classic feature hashing (the "hashing trick"): every token is hashed
 * to a bucket in `[0, dimensions)` with a second hash choosing a +/-1 sign, and
 * the L2-normalised bucket vector is returned. This gives the properties the
 * clustering tests rely on, without any model weights:
 *
 *  - deterministic: identical text always yields the identical vector;
 *  - similarity-preserving: texts sharing most tokens have high cosine
 *    similarity, while texts sharing few tokens have low similarity;
 *  - stable across processes and runs (pure integer arithmetic on UTF-8 bytes).
 *
 * A real provider (OpenAI/Voyage/etc.) is a drop-in implementing the same
 * {@link EmbeddingProvider} interface; none is bundled so the codebase keeps a
 * minimal dependency surface and required CI stays offline.
 */
export interface FakeEmbeddingOptions {
  name?: string;
  model?: string;
  version?: number;
  dimensions?: number;
}

/** FNV-1a 32-bit hash of a string — small, fast, stable, no dependencies. */
function fnv1a(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay in the 32-bit range.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly version: number;
  readonly dimensions: number;

  constructor(options: FakeEmbeddingOptions = {}) {
    this.name = options.name ?? 'fake';
    this.dimensions = options.dimensions ?? 64;
    this.version = options.version ?? 1;
    this.model = options.model ?? `fake-embed-${this.dimensions}`;
  }

  embed(text: string): Promise<number[]> {
    const vector = new Array<number>(this.dimensions).fill(0);
    for (const token of tokenize(text)) {
      const bucket = fnv1a(token, 0x811c9dc5) % this.dimensions;
      // A second, independently-seeded hash chooses the sign, so distinct tokens
      // colliding on a bucket tend to cancel rather than always reinforce.
      const sign = (fnv1a(token, 0x7fffffff) & 1) === 0 ? 1 : -1;
      vector[bucket] = (vector[bucket] ?? 0) + sign;
    }

    // L2-normalise so cosine similarity is a plain dot product. An empty/tokenless
    // text maps to a fixed unit vector rather than an all-zero (NaN-prone) one.
    let norm = 0;
    for (const value of vector) norm += value * value;
    if (norm === 0) {
      vector[0] = 1;
      return Promise.resolve(vector);
    }
    const inv = 1 / Math.sqrt(norm);
    for (let i = 0; i < vector.length; i++) vector[i] = (vector[i] ?? 0) * inv;
    return Promise.resolve(vector);
  }
}
