import { describe, expect, it } from 'vitest';

import {
  clampExcerpt,
  formatRelative,
  formatUtc,
  isoOrNull,
} from '@/public/format';

describe('format helpers', () => {
  it('formatUtc renders a compact absolute UTC label', () => {
    expect(formatUtc('2026-08-12T14:05:00Z')).toBe('12 Aug 2026, 14:05 UTC');
  });

  it('returns null for absent/invalid timestamps', () => {
    expect(formatUtc(null)).toBeNull();
    expect(formatUtc('not-a-date')).toBeNull();
    expect(isoOrNull('nope')).toBeNull();
    expect(formatRelative(undefined)).toBeNull();
  });

  it('formatRelative bins ages against an injected now', () => {
    const now = new Date('2026-08-12T12:00:00Z');
    expect(formatRelative('2026-08-12T11:59:40Z', now)).toBe('just now');
    expect(formatRelative('2026-08-12T11:30:00Z', now)).toBe('30m ago');
    expect(formatRelative('2026-08-12T09:00:00Z', now)).toBe('3h ago');
    expect(formatRelative('2026-08-10T12:00:00Z', now)).toBe('2d ago');
  });

  it('clampExcerpt collapses whitespace and bounds length', () => {
    expect(clampExcerpt('  a\n\n  b   c ')).toBe('a b c');
    expect(clampExcerpt('', 10)).toBeNull();
    const long = 'word '.repeat(100);
    const out = clampExcerpt(long, 40);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(41); // +1 for the ellipsis
    expect(out!.endsWith('…')).toBe(true);
  });
});
