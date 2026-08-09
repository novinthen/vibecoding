import { describe, expect, it } from 'vitest';

import { hashPassword } from '@/admin/auth/password';
import { authenticate, parseRoster } from '@/admin/auth/users';

function roster() {
  return [
    {
      username: 'alice',
      passwordHash: hashPassword('alice-pw'),
      role: 'ADMIN' as const,
    },
    {
      username: 'bob',
      passwordHash: hashPassword('bob-pw'),
      role: 'VIEWER' as const,
    },
  ];
}

describe('admin roster parsing', () => {
  it('parses a valid roster and defaults role to ADMIN', () => {
    const json = JSON.stringify([
      { username: 'a', passwordHash: 'scrypt:1:1:1:aa:bb' },
    ]);
    const parsed = parseRoster(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.role).toBe('ADMIN');
  });

  it('rejects invalid JSON', () => {
    expect(() => parseRoster('{not json')).toThrow(/valid JSON/);
  });

  it('rejects an empty roster', () => {
    expect(() => parseRoster('[]')).toThrow();
  });

  it('rejects entries missing required fields', () => {
    expect(() => parseRoster(JSON.stringify([{ username: 'a' }]))).toThrow();
  });

  it('rejects duplicate usernames', () => {
    const json = JSON.stringify([
      { username: 'dup', passwordHash: 'scrypt:1:1:1:aa:bb' },
      { username: 'dup', passwordHash: 'scrypt:1:1:1:cc:dd' },
    ]);
    expect(() => parseRoster(json)).toThrow(/duplicate/);
  });
});

describe('admin authentication', () => {
  it('authenticates a valid credential pair and returns role', () => {
    const result = authenticate(roster(), 'alice', 'alice-pw');
    expect(result).toEqual({ username: 'alice', role: 'ADMIN' });
  });

  it('rejects a wrong password', () => {
    expect(authenticate(roster(), 'alice', 'nope')).toBeNull();
  });

  it('rejects an unknown username', () => {
    expect(authenticate(roster(), 'mallory', 'whatever')).toBeNull();
  });

  it('preserves per-user role (VIEWER)', () => {
    expect(authenticate(roster(), 'bob', 'bob-pw')).toEqual({
      username: 'bob',
      role: 'VIEWER',
    });
  });
});
