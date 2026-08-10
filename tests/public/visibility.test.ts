import { describe, expect, it } from 'vitest';

import { ARTICLE_STATUSES } from '@/domain/enums';
import {
  PUBLIC_ARTICLE_STATUSES,
  isPubliclyVisibleArticle,
  publicArticleStatusSql,
} from '@/domain/article-visibility';

/**
 * The public-visibility rule decides what the portal will ever show. Publishing
 * is an explicit editorial gate: ONLY `PUBLISHED` Articles are public. Every
 * pre-publication lifecycle state and every excluded state must be non-public,
 * and the SQL fragment must agree with the TypeScript predicate.
 */
describe('article visibility', () => {
  it('treats exactly PUBLISHED as public', () => {
    expect([...PUBLIC_ARTICLE_STATUSES]).toEqual(['PUBLISHED']);
  });

  it('predicate is true only for PUBLISHED across every status', () => {
    for (const status of ARTICLE_STATUSES) {
      expect(isPubliclyVisibleArticle(status)).toBe(status === 'PUBLISHED');
    }
  });

  it('does NOT expose pre-publication lifecycle states', () => {
    // These are ingestion/enrichment states and must never be public in Stage 5.
    expect(isPubliclyVisibleArticle('DISCOVERED')).toBe(false);
    expect(isPubliclyVisibleArticle('NORMALIZED')).toBe(false);
    expect(isPubliclyVisibleArticle('QUEUED')).toBe(false);
    expect(isPubliclyVisibleArticle('ENRICHED')).toBe(false);
    expect(isPubliclyVisibleArticle('CLUSTERED')).toBe(false);
  });

  it('keeps HIDDEN/DUPLICATE/FAILED non-public', () => {
    expect(isPubliclyVisibleArticle('HIDDEN')).toBe(false);
    expect(isPubliclyVisibleArticle('DUPLICATE')).toBe(false);
    expect(isPubliclyVisibleArticle('FAILED')).toBe(false);
  });

  it('builds an inert, alias-qualified IN clause with no bound params', () => {
    const sql = publicArticleStatusSql('a');
    expect(sql).toBe("a.status IN ('PUBLISHED')");
    // No parameter placeholders — the value comes from the controlled vocabulary.
    expect(sql).not.toContain('$');
  });
});
