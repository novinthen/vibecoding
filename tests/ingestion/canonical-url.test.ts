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
      'https://example.com/x?id=5&utm_campaign=a&gclid=q',
    );
    const b = canonicalizeUrl(
      'https://example.com/x?utm_campaign=b&id=5&fbclid=zzz',
    );
    expect(a).toBe(b);
    expect(a).toBe('https://example.com/x?id=5');
  });

  it('removes known analytics/ad/email tracking parameters', () => {
    expect(
      canonicalizeUrl(
        'https://example.com/p?utm_campaign=c&gclid=1&fbclid=2&msclkid=3&mc_eid=4&mkt_tok=5&pk_campaign=6',
      ),
    ).toBe('https://example.com/p');
  });

  it('preserves generic/ambiguous parameters (conservative: no false merges)', () => {
    // ref / ref_src / ref_url / referrer / source are site-specific: they may
    // be tracking OR select the resource. Preserve them so two distinct
    // resources are never collapsed.
    for (const param of [
      'ref=hn',
      'ref_src=twsrc',
      'ref_url=https%3A%2F%2Fx.example',
      'referrer=abc',
      'source=newsletter',
      'campaign_id=42',
      'unknown_param=1',
    ]) {
      const url = `https://example.com/x?${param}`;
      expect(canonicalizeUrl(url)).toBe(url);
    }
  });

  it('keeps URLs distinct when they differ by a meaningful query parameter', () => {
    const one = canonicalizeUrl('https://example.com/x?id=5&ref=hn');
    const two = canonicalizeUrl('https://example.com/x?id=6&ref=hn');
    expect(one).not.toBe(two);
    // Stripping only the tracking noise must not merge these either.
    const withNoise = canonicalizeUrl(
      'https://example.com/x?id=5&ref=hn&utm_source=z',
    );
    expect(withNoise).toBe(one);
    expect(withNoise).not.toBe(two);
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

  it('does not match ordinary or generic parameters', () => {
    for (const name of [
      'id',
      'page',
      'q',
      'ref',
      'ref_src',
      'ref_url',
      'referrer',
      'source',
      'campaign_id',
      'cmpid',
    ]) {
      expect(isTrackingParam(name)).toBe(false);
    }
  });
});
