import { describe, expect, it } from 'vitest';

import { displayHost, safeExternalUrl } from '@/lib/safe-url';

/**
 * The shared safe-URL policy underpins every outbound link on the public portal.
 * Only http(s) may become a link; everything else is inert.
 */
describe('safeExternalUrl', () => {
  it('permits http and https', () => {
    expect(safeExternalUrl('https://example.com/a')).toBe(
      'https://example.com/a',
    );
    expect(safeExternalUrl('http://example.com')).toBe('http://example.com');
  });

  it('rejects dangerous or unparseable schemes', () => {
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('data:text/html,<script>')).toBeNull();
    expect(safeExternalUrl('mailto:a@b.com')).toBeNull();
    expect(safeExternalUrl('not a url')).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl('')).toBeNull();
  });
});

describe('displayHost', () => {
  it('returns the bare host without www', () => {
    expect(displayHost('https://www.example.com/a/b?c=1')).toBe('example.com');
    expect(displayHost('http://news.example.org')).toBe('news.example.org');
  });

  it('returns null for unsafe URLs', () => {
    expect(displayHost('javascript:alert(1)')).toBeNull();
    expect(displayHost(null)).toBeNull();
  });
});
