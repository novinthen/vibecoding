import { describe, expect, it } from 'vitest';

import { safeExternalUrl } from '@/admin/safe-url';

describe('safeExternalUrl', () => {
  it('accepts http and https URLs', () => {
    expect(safeExternalUrl('https://example.com/a')).toBe(
      'https://example.com/a',
    );
    expect(safeExternalUrl('http://example.com')).toBe('http://example.com');
  });

  it('rejects javascript: and data: URLs', () => {
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(
      safeExternalUrl('data:text/html,<script>alert(1)</script>'),
    ).toBeNull();
  });

  it('rejects other schemes and garbage', () => {
    expect(safeExternalUrl('ftp://example.com')).toBeNull();
    expect(safeExternalUrl('file:///etc/passwd')).toBeNull();
    expect(safeExternalUrl('not a url')).toBeNull();
  });

  it('treats null/empty as no URL', () => {
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl('')).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
  });
});
