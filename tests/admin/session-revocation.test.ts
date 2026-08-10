import { describe, expect, it } from 'vitest';

import { hashPassword } from '@/admin/auth/password';
import { createSessionToken, verifySessionToken } from '@/admin/auth/session';
import { reconcileSessionWithRoster, type AdminUser } from '@/admin/auth/users';

const SECRET = 'revocation-secret-value-01234567890123456789';

/**
 * Session revocation via live-roster reconciliation.
 *
 * A signed, unexpired session must still be re-checked against the CURRENT
 * roster on every request, so removing an admin from ADMIN_USERS or changing
 * their role takes effect immediately (before the 12h token expiry) without a
 * session store. These tests exercise the pure reconciliation used by
 * getCurrentAdmin, plus the composed verify+reconcile pipeline getCurrentAdmin
 * runs.
 */

function roster(
  entries: ReadonlyArray<{ username: string; role: AdminUser['role'] }>,
): AdminUser[] {
  return entries.map((e) => ({
    username: e.username,
    passwordHash: hashPassword(`${e.username}-pw`),
    role: e.role,
  }));
}

/**
 * The full getCurrentAdmin decision, minus the cookie read: verify signature +
 * expiry, then reconcile against the current roster.
 */
function accept(
  token: string,
  currentRoster: AdminUser[],
): { username: string; role: string } | null {
  const session = verifySessionToken(token, SECRET);
  if (!session) return null;
  if (!reconcileSessionWithRoster(currentRoster, session)) return null;
  return { username: session.username, role: session.role };
}

describe('session reconciliation against the live roster', () => {
  it('1. accepts a valid token whose username + role still match the roster', () => {
    const token = createSessionToken(
      { username: 'alice', role: 'ADMIN' },
      SECRET,
    );
    const current = roster([{ username: 'alice', role: 'ADMIN' }]);
    expect(accept(token, current)).toEqual({
      username: 'alice',
      role: 'ADMIN',
    });
  });

  it('2. rejects a valid token for an admin removed from the roster', () => {
    const token = createSessionToken(
      { username: 'alice', role: 'ADMIN' },
      SECRET,
    );
    const current = roster([{ username: 'bob', role: 'ADMIN' }]); // alice removed
    expect(
      reconcileSessionWithRoster(current, { username: 'alice', role: 'ADMIN' }),
    ).toBe(false);
    expect(accept(token, current)).toBeNull();
  });

  it('3. rejects a valid token whose roster role was downgraded (ADMIN → VIEWER)', () => {
    const token = createSessionToken(
      { username: 'alice', role: 'ADMIN' },
      SECRET,
    );
    const current = roster([{ username: 'alice', role: 'VIEWER' }]);
    expect(accept(token, current)).toBeNull();
  });

  it('4. rejects a valid token whose roster role was upgraded/changed (VIEWER → ADMIN) until re-login', () => {
    const token = createSessionToken(
      { username: 'alice', role: 'VIEWER' },
      SECRET,
    );
    const current = roster([{ username: 'alice', role: 'ADMIN' }]);
    // The old VIEWER token must NOT silently gain ADMIN; re-login required.
    expect(accept(token, current)).toBeNull();
    // After re-login a fresh token carries the new role and is accepted.
    const fresh = createSessionToken(
      { username: 'alice', role: 'ADMIN' },
      SECRET,
    );
    expect(accept(fresh, current)).toEqual({
      username: 'alice',
      role: 'ADMIN',
    });
  });

  it('5a. forged (bad-signature) tokens are still rejected before reconciliation', () => {
    const token = createSessionToken(
      { username: 'alice', role: 'VIEWER' },
      SECRET,
    );
    const [payload] = token.split('.');
    const forged = `${payload}.tampered-signature`;
    const current = roster([{ username: 'alice', role: 'ADMIN' }]);
    // Rejected at the signature gate regardless of what the roster says.
    expect(verifySessionToken(forged, SECRET)).toBeNull();
    expect(accept(forged, current)).toBeNull();
  });

  it('5b. expired tokens are still rejected before reconciliation', () => {
    const base = new Date('2026-01-01T00:00:00Z');
    const token = createSessionToken(
      { username: 'alice', role: 'ADMIN' },
      SECRET,
      { ttlSeconds: 60, now: () => base },
    );
    const current = roster([{ username: 'alice', role: 'ADMIN' }]);
    const later = new Date(base.getTime() + 61_000);
    // Expired at the signature/expiry gate even though the roster matches:
    // verify returns null, so reconciliation is never even consulted.
    expect(verifySessionToken(token, SECRET, { now: () => later })).toBeNull();
    expect(
      reconcileSessionWithRoster(current, { username: 'alice', role: 'ADMIN' }),
    ).toBe(true);
  });

  it('reconciliation is case-sensitive on username (no accidental match)', () => {
    const current = roster([{ username: 'alice', role: 'ADMIN' }]);
    expect(
      reconcileSessionWithRoster(current, { username: 'Alice', role: 'ADMIN' }),
    ).toBe(false);
  });
});
