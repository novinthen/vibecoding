import { describe, expect, it } from 'vitest';

import { ARTICLE_STATUSES } from '@/domain/enums';
import {
  NON_PUBLIC_ARTICLE_STATUSES,
  isPubliclyVisibleArticle,
  publicArticleStatusSql,
} from '@/domain/article-visibility';

/**
 * The public-visibility rule decides what the portal will ever show. It must
 * exclude exactly HIDDEN/DUPLICATE/FAILED and nothing else, and the SQL fragment
 * must agree with the TypeScript predicate.
 */
describe('article visibility', () => {
  it('hides exactly HIDDEN, DUPLICATE, and FAILED', () => {
    expect([...NON_PUBLIC_ARTICLE_STATUSES].sort()).toEqual(
      ['DUPLICATE', 'FAILED', 'HIDDEN'].sort(),
    );
  });

  it('predicate agrees with the excluded set for every status', () => {
    for (const status of ARTICLE_STATUSES) {
      const excluded = (
        NON_PUBLIC_ARTICLE_STATUSES as readonly string[]
      ).includes(status);
      expect(isPubliclyVisibleArticle(status)).toBe(!excluded);
    }
  });

  it('shows ingested-but-not-yet-enriched articles (DISCOVERED)', () => {
    // The portal is an aggregator today: DISCOVERED items are legitimately public.
    expect(isPubliclyVisibleArticle('DISCOVERED')).toBe(true);
    expect(isPubliclyVisibleArticle('PUBLISHED')).toBe(true);
  });

  it('builds an inert, alias-qualified NOT IN clause with no bound params', () => {
    const sql = publicArticleStatusSql('a');
    expect(sql).toBe("a.status NOT IN ('HIDDEN', 'DUPLICATE', 'FAILED')");
    // No parameter placeholders — the values come from the controlled vocabulary.
    expect(sql).not.toContain('$');
  });
});
