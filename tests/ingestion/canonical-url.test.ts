import { describe, expect, it } from 'vitest';

import {
  CanonicalUrlError,
  canonicalizeUrl,
  isTrackingParam,
  tryCanonicalizeUrl,
} from '@/ingestion';

describe('canonicalizeUrl', () => {
  it('lowercases scheme and host but preserves path case', () => {
    expect(canonicalizeUrl('HTTP://Example.COM/Path/To/Post')).toBe(
      'http://example.com/Path/To/Post',
    );
  });

  it('drops default ports', () => {
    expect(canonicalizeUrl('https://example.com:443/a')).toBe(
      'https://example.com/a',
    );
    expect(canonicalizeUrl('http://example.com:80/a')).toBe(
      'http://example.com/a',
    );
  });

  it('keeps a non-default port', () => {
    expect(canonicalizeUrl('https://example.com:8443/a')).toBe(
      'https://example.com:8443/a',
    );
  });

  it('removes the fragment', () => {
    expect(canonicalizeUrl('https://example.com/a#section')).toBe(
      'https://example.com/a',
    );
  });

  it('removes a trailing slash except on the root', () => {
    expect(canonicalizeUrl('https://example.com/a/b/')).toBe(
      'https://example.com/a/b',
    );
    expect(canonicalizeUrl('https://example.com/')).toBe(
      'https://example.com/',
    );
  });

  it('strips known tracking parameters', () => {
    expect(
      canonicalizeUrl(
        'https://example.com/p?utm_source=x&utm_medium=y&fbclid=z&gclid=q',
      ),
    ).toBe('https://example.com/p');
  });

  it('preserves meaningful query parameters and sorts them deterministically', () => {
    expect(
      canonicalizeUrl('https://example.com/search?q=mcp&page=2&utm_source=rss'),
    ).toBe('https://example.com/search?page=2&q=mcp');
  });

  it('produces a stable key regardless of tracking-noise ordering', () => {
    const a = canonicalizeUrl(
      'https://example.com/x?id=5&utm_campaign=a&ref=hn',
    );
    const b = canonicalizeUrl(
      'https://example.com/x?utm_campaign=b&id=5&fbclid=zzz',
    );
    expect(a).toBe(b);
    expect(a).toBe('https://example.com/x?id=5');
  });

  it('keeps an unknown parameter even when it looks disposable', () => {
    // `unknown_param` is not on the tracking list, so it must be preserved.
    expect(canonicalizeUrl('https://example.com/x?unknown_param=1')).toBe(
      'https://example.com/x?unknown_param=1',
    );
  });

  it('throws on unsupported schemes', () => {
    expect(() => canonicalizeUrl('ftp://example.com/a')).toThrow(
      CanonicalUrlError,
    );
    expect(() => canonicalizeUrl('javascript:alert(1)')).toThrow(
      CanonicalUrlError,
    );
  });

  it('throws on unparseable input', () => {
    expect(() => canonicalizeUrl('not a url')).toThrow(CanonicalUrlError);
  });
});

describe('tryCanonicalizeUrl', () => {
  it('returns the original string when canonicalization fails', () => {
    expect(tryCanonicalizeUrl('not a url')).toBe('not a url');
  });
});

describe('isTrackingParam', () => {
  it('matches the utm_ family and known click ids', () => {
    expect(isTrackingParam('utm_anything')).toBe(true);
    expect(isTrackingParam('FBCLID')).toBe(true);
    expect(isTrackingParam('gclid')).toBe(true);
  });

  it('does not match ordinary parameters', () => {
    expect(isTrackingParam('id')).toBe(false);
    expect(isTrackingParam('page')).toBe(false);
    expect(isTrackingParam('q')).toBe(false);
  });
});
