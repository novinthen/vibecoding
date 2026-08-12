import { describe, expect, it } from 'vitest';

// next.config.mjs is plain JS (no type declaration); model the shape we assert.
// @ts-expect-error untyped JS module imported deliberately for this assertion
import nextConfigModule from '../../next.config.mjs';

interface HeaderEntry {
  key: string;
  value: string;
}
interface HeaderRule {
  source: string;
  headers: HeaderEntry[];
}
interface NextConfigShape {
  poweredByHeader?: boolean;
  headers?: () => Promise<HeaderRule[]>;
}

const nextConfig = nextConfigModule as NextConfigShape;

/**
 * Stage 10 — baseline security response headers.
 *
 * Guards against accidental removal of the hardening headers applied to every
 * route. Asserts the presence of the framework-safe headers; a strict CSP is
 * intentionally NOT asserted (documented as deferred hardening).
 */
describe('next.config security headers', () => {
  it('applies the baseline hardening headers to every path', async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    expect(typeof nextConfig.headers).toBe('function');

    const rules = (await nextConfig.headers?.()) ?? [];
    const all = rules.find((r) => r.source === '/:path*');
    expect(all).toBeTruthy();

    const byKey = new Map(
      (all?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]),
    );
    expect(byKey.get('x-content-type-options')).toBe('nosniff');
    expect(byKey.get('x-frame-options')).toBe('DENY');
    expect(byKey.get('referrer-policy')).toBe(
      'strict-origin-when-cross-origin',
    );
    expect(byKey.get('strict-transport-security')).toContain('max-age=');
    expect(byKey.has('permissions-policy')).toBe(true);
  });
});
