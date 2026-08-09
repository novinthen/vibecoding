import { createHmac, timingSafeEqual } from 'node:crypto';

import { adminRoleSchema, type AdminRole } from '@/domain/enums';

/**
 * Stateless admin session tokens (Stage 4).
 *
 * A session is a compact, HMAC-SHA256-signed token: `payloadB64url.sigB64url`.
 * The payload carries the acting admin's username, role, and issue/expiry
 * timestamps. Because it is signed with a server-only secret, it cannot be
 * forged or altered by a client. There is no server-side session store — a
 * deliberate minimal choice for Stage 4 (no Redis, no session table). Tokens
 * are short-lived; expiry is enforced on every verification.
 *
 * The token is transported as an httpOnly cookie (see current-admin.ts), so it
 * is never readable by page JavaScript.
 */

export interface AdminSession {
  /** Admin username (used as the audit actor identifier). */
  username: string;
  role: AdminRole;
  /** Issued-at (epoch seconds). */
  iat: number;
  /** Expiry (epoch seconds). */
  exp: number;
}

/** Default session lifetime: 12 hours. */
export const DEFAULT_SESSION_TTL_SECONDS = 12 * 60 * 60;

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64url(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

function sign(payloadB64: string, secret: string): string {
  return base64url(createHmac('sha256', secret).update(payloadB64).digest());
}

export interface CreateSessionOptions {
  ttlSeconds?: number;
  now?: () => Date;
}

/** Create a signed session token for an authenticated admin. */
export function createSessionToken(
  input: { username: string; role: AdminRole },
  secret: string,
  options: CreateSessionOptions = {},
): string {
  const now = options.now ?? (() => new Date());
  const iat = Math.floor(now().getTime() / 1000);
  const ttl = options.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  const session: AdminSession = {
    username: input.username,
    role: input.role,
    iat,
    exp: iat + ttl,
  };
  const payloadB64 = base64url(JSON.stringify(session));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/**
 * Verify and decode a session token. Returns the session on success, or null
 * for any failure: malformed token, bad signature, unknown role, or expiry.
 * Never throws, so callers can treat "no valid session" uniformly.
 */
export function verifySessionToken(
  token: string,
  secret: string,
  options: { now?: () => Date } = {},
): AdminSession | null {
  const now = options.now ?? (() => new Date());
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const payloadB64 = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);

  const expectedSig = sign(payloadB64, secret);
  const providedBuf = fromBase64url(providedSig);
  const expectedBuf = fromBase64url(expectedSig);
  if (
    providedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(providedBuf, expectedBuf)
  ) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64url(payloadB64).toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;

  const role = adminRoleSchema.safeParse(record.role);
  if (
    typeof record.username !== 'string' ||
    record.username.length === 0 ||
    !role.success ||
    typeof record.iat !== 'number' ||
    typeof record.exp !== 'number'
  ) {
    return null;
  }

  const nowSeconds = Math.floor(now().getTime() / 1000);
  if (record.exp <= nowSeconds) return null;

  return {
    username: record.username,
    role: role.data,
    iat: record.iat,
    exp: record.exp,
  };
}
