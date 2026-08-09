import { describe, expect, it } from 'vitest';

import { canonicalizeUrl, contentHash, urlHash } from '@/ingestion';

describe('urlHash', () => {
  it('is a stable 64-char hex digest', () => {
    const h = urlHash('https://example.com/a');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(urlHash('https://example.com/a')).toBe(h);
  });

  it('differs for different canonical URLs', () => {
    expect(urlHash('https://example.com/a')).not.toBe(
      urlHash('https://example.com/b'),
    );
  });

  it('collapses tracking-only differences once URLs are canonicalized', () => {
    const a = urlHash(canonicalizeUrl('https://example.com/a?utm_source=x'));
    const b = urlHash(canonicalizeUrl('https://example.com/a?fbclid=y'));
    expect(a).toBe(b);
  });
});

describe('contentHash', () => {
  it('ignores insignificant whitespace differences', () => {
    expect(contentHash({ title: 'Hello   world', excerpt: 'a  b' })).toBe(
      contentHash({ title: 'Hello world', excerpt: 'a b' }),
    );
  });

  it('changes when content changes', () => {
    expect(contentHash({ title: 'A', excerpt: 'x' })).not.toBe(
      contentHash({ title: 'A', excerpt: 'y' }),
    );
  });

  it('treats missing fields as empty deterministically', () => {
    expect(contentHash({ title: 'A' })).toBe(
      contentHash({ title: 'A', excerpt: null, body: null }),
    );
  });
});
