/**
 * Admin auth barrel (Stage 4).
 *
 * Framework-free authentication/authorization primitives: password hashing,
 * signed session tokens, roster parsing/authentication, and the authorization
 * guard. The Next-specific glue (cookies/redirect) lives in current-admin.ts and
 * is intentionally kept out of this barrel so these cores stay unit-testable.
 */
export { hashPassword, verifyPassword } from './password';
export {
  createSessionToken,
  verifySessionToken,
  DEFAULT_SESSION_TTL_SECONDS,
  type AdminSession,
} from './session';
export { parseRoster, loadRoster, authenticate, type AdminUser } from './users';
export {
  UnauthorizedError,
  canMutate,
  assertCanMutate,
  assertAuthenticated,
} from './guard';
