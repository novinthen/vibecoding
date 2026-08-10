import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing for admin credentials (Stage 4).
 *
 * Uses Node's built-in scrypt — a memory-hard KDF from the standard library —
 * so no third-party auth/crypto dependency is introduced (CLAUDE.md dependency
 * philosophy). Credentials are stored ONLY as hashes; plaintext passwords are
 * never persisted or committed. Verification is constant-time to avoid leaking
 * information through timing.
 *
 * Stored format: `scrypt:<N>:<r>:<p>:<saltHex>:<hashHex>`.
 */

const SCHEME = 'scrypt';
// Cost parameters. N must be a power of two; these are a sensible interactive
// default well within Node's default maxmem for a 64-byte derived key.
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

/** Hash a plaintext password into the portable stored format. */
export function hashPassword(password: string): string {
  if (password.length === 0) {
    throw new Error('Cannot hash an empty password.');
  }
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return `${SCHEME}:${N}:${R}:${P}:${salt.toString('hex')}:${derived.toString('hex')}`;
}

/**
 * Verify a plaintext password against a stored hash. Returns false for any
 * malformed hash rather than throwing, so a corrupt roster entry cannot crash
 * the login path. Constant-time comparison.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 6) return false;
  const [scheme, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  if (scheme !== SCHEME) return false;
  if (!nRaw || !rRaw || !pRaw || !saltHex || !hashHex) return false;

  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = scryptSync(password, salt, expected.length, { N: n, r, p });
  } catch {
    return false;
  }
  return (
    derived.length === expected.length && timingSafeEqual(derived, expected)
  );
}
