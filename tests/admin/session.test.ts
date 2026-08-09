import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createSessionToken, verifySessionToken } from '@/admin/auth/session';

const SECRET = 'test-signing-secret-value-1234567890';

/** Sign a base64url payload exactly as the session module does. */
function sign(payloadB64: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

describe('admin session tokens', () => {
  it('round-trips a valid session', () => {
    const token = createSessionToken(
      { username: 'alice', role: 'ADMIN' },
      SECRET,
    );
    const session = verifySessionToken(token, SECRET);
    expect(session).not.toBeNull();
    expect(session?.username).toBe('alice');
    expect(session?.role).toBe('ADMIN');
    expect(session?.exp).toBeGreaterThan(session!.iat);
  });

  it('rejects a token signed with a different secret', () => {
    const token = createSessionToken(
      { username: 'alice', role: 'EDITOR' },
      SECRET,
    );
    expect(verifySessionToken(token, 'another-secret')).toBeNull();
  });

  it('rejects a tampered payload (signature no longer matches)', () => {
    const token = createSessionToken(
      { username: 'viewer', role: 'VIEWER' },
      SECRET,
    );
    const [payload, sig] = token.split('.');
    // Flip the payload to claim ADMIN without re-signing.
    const forged = Buffer.from(
      JSON.stringify({
        username: 'viewer',
        role: 'ADMIN',
        iat: 0,
        exp: 9_999_999_999,
      }),
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(verifySessionToken(`${forged}.${sig}`, SECRET)).toBeNull();
    // Sanity: the untampered token still verifies.
    expect(verifySessionToken(`${payload}.${sig}`, SECRET)).not.toBeNull();
  });

  it('rejects an expired token', () => {
    const base = new Date('2026-01-01T00:00:00Z');
    const token = createSessionToken({ username: 'a', role: 'ADMIN' }, SECRET, {
      ttlSeconds: 60,
      now: () => base,
    });
    const later = new Date(base.getTime() + 61_000);
    expect(verifySessionToken(token, SECRET, { now: () => later })).toBeNull();
    // Still valid one second before expiry.
    const before = new Date(base.getTime() + 59_000);
    expect(
      verifySessionToken(token, SECRET, { now: () => before }),
    ).not.toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifySessionToken('', SECRET)).toBeNull();
    expect(verifySessionToken('no-dot', SECRET)).toBeNull();
    expect(verifySessionToken('.sigonly', SECRET)).toBeNull();
    expect(verifySessionToken('payloadonly.', SECRET)).toBeNull();
  });

  it('rejects a correctly-signed payload carrying an unknown role', () => {
    const payload = Buffer.from(
      JSON.stringify({ username: 'x', role: 'SUPERUSER', iat: 0, exp: 9e9 }),
    ).toString('base64url');
    // Signed correctly, so ONLY the role validation can reject it.
    const token = `${payload}.${sign(payload)}`;
    expect(verifySessionToken(token, SECRET)).toBeNull();
  });
});
