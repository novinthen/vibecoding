import { z } from 'zod';

import { requireAdminAuthConfig, type AdminAuthConfig } from '@/config/env';
import { adminRoleSchema, type AdminRole } from '@/domain/enums';

import { verifyPassword } from './password';

/**
 * Admin roster parsing and credential authentication (Stage 4).
 *
 * Admins are configured via the ADMIN_USERS environment variable (a JSON array),
 * not stored in the database. This keeps Stage 4 free of a user-management
 * subsystem while still supporting multiple named admins with distinct roles and
 * per-admin audit identity. Passwords are only ever present as scrypt hashes.
 */

const adminUserSchema = z.object({
  username: z.string().min(1),
  passwordHash: z.string().min(1),
  role: adminRoleSchema.default('ADMIN'),
});

const rosterSchema = z.array(adminUserSchema).min(1);

export interface AdminUser {
  username: string;
  passwordHash: string;
  role: AdminRole;
}

/**
 * Parse and validate the admin roster JSON. Throws a clear error on malformed
 * configuration so misconfiguration fails loudly rather than silently locking
 * everyone out (or, worse, letting an empty roster through).
 */
export function parseRoster(usersJson: string): AdminUser[] {
  let raw: unknown;
  try {
    raw = JSON.parse(usersJson);
  } catch {
    throw new Error('ADMIN_USERS is not valid JSON.');
  }
  const result = rosterSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      'ADMIN_USERS is malformed: expected a non-empty JSON array of ' +
        '{ username, passwordHash, role? }.',
    );
  }
  // Reject duplicate usernames — an ambiguous roster is a configuration bug.
  const seen = new Set<string>();
  for (const user of result.data) {
    if (seen.has(user.username)) {
      throw new Error(
        `ADMIN_USERS contains duplicate username "${user.username}".`,
      );
    }
    seen.add(user.username);
  }
  return result.data;
}

/** Load the roster from the resolved admin auth config (throws if unconfigured). */
export function loadRoster(
  config: AdminAuthConfig = requireAdminAuthConfig(),
): AdminUser[] {
  return parseRoster(config.usersJson);
}

/**
 * Authenticate a username/password pair against a roster. Returns the matched
 * admin (minus the hash) on success, or null on any failure.
 *
 * To avoid a username-enumeration timing oracle, a password verification is
 * performed even when the username is unknown (against a dummy hash), so the
 * response time does not reveal whether the username exists.
 */
const DUMMY_HASH =
  'scrypt:16384:8:1:00000000000000000000000000000000:' + '0'.repeat(128);

export function authenticate(
  roster: readonly AdminUser[],
  username: string,
  password: string,
): { username: string; role: AdminRole } | null {
  const user = roster.find((candidate) => candidate.username === username);
  const hash = user?.passwordHash ?? DUMMY_HASH;
  const ok = verifyPassword(password, hash);
  if (!user || !ok) return null;
  return { username: user.username, role: user.role };
}

/**
 * Re-validate an already-issued session against the CURRENT roster, so that
 * membership and role remain authoritative for the life of the session — not
 * frozen at issue time. A signed session is trusted for its identity claim, but
 * its privileges are only honoured while they still match the roster.
 *
 * The session is accepted only if the username still exists AND the current
 * roster role exactly matches the role carried by the session. Any mismatch
 * (removed admin, downgraded, upgraded, or otherwise changed role) rejects the
 * session, forcing a fresh login. No password is re-checked here — this is a
 * cheap, stateless roster lookup, not re-authentication.
 */
export function reconcileSessionWithRoster(
  roster: readonly AdminUser[],
  session: { username: string; role: AdminRole },
): boolean {
  const user = roster.find(
    (candidate) => candidate.username === session.username,
  );
  if (!user) return false;
  return user.role === session.role;
}
