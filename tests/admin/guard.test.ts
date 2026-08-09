import { describe, expect, it } from 'vitest';

import {
  assertAuthenticated,
  assertCanMutate,
  canMutate,
  UnauthorizedError,
} from '@/admin/auth/guard';
import type { AdminSession } from '@/admin/auth/session';

function session(role: AdminSession['role']): AdminSession {
  return { username: 'u', role, iat: 0, exp: 9_999_999_999 };
}

describe('admin authorization guard', () => {
  it('permits ADMIN and EDITOR to mutate', () => {
    expect(canMutate('ADMIN')).toBe(true);
    expect(canMutate('EDITOR')).toBe(true);
  });

  it('forbids VIEWER from mutating', () => {
    expect(canMutate('VIEWER')).toBe(false);
  });

  it('assertCanMutate returns the session for a mutating role', () => {
    expect(assertCanMutate(session('EDITOR')).role).toBe('EDITOR');
  });

  it('assertCanMutate throws UnauthorizedError for VIEWER', () => {
    expect(() => assertCanMutate(session('VIEWER'))).toThrow(UnauthorizedError);
  });

  it('assertCanMutate throws when there is no session', () => {
    expect(() => assertCanMutate(null)).toThrow(UnauthorizedError);
  });

  it('assertAuthenticated accepts any role but rejects null', () => {
    expect(assertAuthenticated(session('VIEWER')).role).toBe('VIEWER');
    expect(() => assertAuthenticated(null)).toThrow(UnauthorizedError);
  });
});
