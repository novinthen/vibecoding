/**
 * Safe handling of untrusted URLs (admin surface).
 *
 * The decision logic lives in the shared `@/lib/safe-url` module so the admin
 * and the public portal apply exactly the same rule. This thin re-export keeps
 * the existing `@/admin/safe-url` import path (and its tests) stable.
 */
export { safeExternalUrl } from '@/lib/safe-url';
