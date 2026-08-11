import { resolveEmbeddingConfig } from '@/config/env';

import { FakeEmbeddingProvider } from './fake-provider';
import type { EmbeddingProvider } from './types';

/**
 * Construct the configured embedding provider (Stage 7). The single place that
 * maps configuration to a concrete {@link EmbeddingProvider}, so the clustering
 * engine depends only on the interface. Only the deterministic `fake` provider
 * exists today; adding a real one is a change here plus a new adapter.
 */
export function resolveEmbeddingProvider(): EmbeddingProvider {
  const config = resolveEmbeddingConfig();
  switch (config.provider) {
    case 'fake':
      return new FakeEmbeddingProvider();
    default: {
      const never: never = config.provider;
      throw new Error(`Unsupported embedding provider: ${String(never)}`);
    }
  }
}
