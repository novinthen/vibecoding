import type { AdminRole } from '@/domain/enums';

import type { AdminSession } from './session';

/**
 * Authorization primitives (Stage 4).
 *
 * Authorization is enforced server-side, independent of any UI. These pure
 * helpers decide whether a session may perform an action; the Next glue and the
 * admin services call them before mutating. Hiding a button is never the
 * control — every mutation path re-checks here.
 */

/** Thrown when an action is attempted without sufficient authorization. */
export class UnauthorizedError extends Error {
  constructor(message = 'Not authorized.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Roles permitted to perform editorial/admin mutations. Stage 4 keeps this
 * coarse: VIEWER is read-only; ADMIN and EDITOR may mutate.
 */
const MUTATING_ROLES: ReadonlySet<AdminRole> = new Set<AdminRole>([
  'ADMIN',
  'EDITOR',
]);

/** Whether a role may perform mutations. */
export function canMutate(role: AdminRole): boolean {
  return MUTATING_ROLES.has(role);
}

/**
 * Assert that a session is present and may mutate. Throws UnauthorizedError
 * otherwise. Used by every admin service before it writes.
 */
export function assertCanMutate(session: AdminSession | null): AdminSession {
  if (!session) {
    throw new UnauthorizedError('Authentication required.');
  }
  if (!canMutate(session.role)) {
    throw new UnauthorizedError(
      `Role ${session.role} is not permitted to perform this action.`,
    );
  }
  return session;
}

/** Assert that a session is present (any authenticated admin). */
export function assertAuthenticated(
  session: AdminSession | null,
): AdminSession {
  if (!session) {
    throw new UnauthorizedError('Authentication required.');
  }
  return session;
}
