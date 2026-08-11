import type { SourceRow } from '@/domain/types';

import { feedAcquirer } from './feed-acquirer';
import { githubAcquirer } from './github-acquirer';
import { hackerNewsAcquirer } from './hacker-news-acquirer';
import type {
  AcquisitionContext,
  AcquisitionResult,
  SourceAcquirer,
} from './types';

export type {
  AcquisitionContext,
  AcquisitionResult,
  SourceAcquirer,
} from './types';
export { feedAcquirer } from './feed-acquirer';
export { githubAcquirer } from './github-acquirer';
export { hackerNewsAcquirer } from './hacker-news-acquirer';

/**
 * Select the acquirer for a Source type. GitHub and Hacker News have dedicated
 * acquirers; every other type falls back to the RSS/Atom feed acquirer, which
 * preserves the pre-9B behaviour for RSS, ATOM, RSSHUB, API, and MANUAL.
 */
export function acquirerForSourceType(
  sourceType: SourceRow['source_type'],
): SourceAcquirer {
  switch (sourceType) {
    case 'GITHUB':
      return githubAcquirer;
    case 'HACKER_NEWS':
      return hackerNewsAcquirer;
    default:
      return feedAcquirer;
  }
}

/** Acquire canonical items for one Source through its type's acquirer. */
export function acquireForSource(
  source: SourceRow,
  ctx: AcquisitionContext,
): Promise<AcquisitionResult> {
  return acquirerForSourceType(source.source_type).acquire(source, ctx);
}
