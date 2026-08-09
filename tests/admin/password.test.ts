import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from '@/admin/auth/password';

describe('admin password hashing', () => {
  it('verifies a correct password against its hash', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects an incorrect password', () => {
    const hash = hashPassword('s3cret-value');
    expect(verifyPassword('wrong', hash)).toBe(false);
  });

  it('produces a unique salt per hash (no plaintext, non-deterministic)', () => {
    const a = hashPassword('same-password');
    const b = hashPassword('same-password');
    expect(a).not.toEqual(b);
    expect(a).not.toContain('same-password');
    expect(verifyPassword('same-password', a)).toBe(true);
    expect(verifyPassword('same-password', b)).toBe(true);
  });

  it('returns false for malformed stored hashes rather than throwing', () => {
    expect(verifyPassword('x', '')).toBe(false);
    expect(verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(verifyPassword('x', 'scrypt:16384:8:1:zz:zz')).toBe(false);
    expect(verifyPassword('x', 'bcrypt:16384:8:1:aa:bb')).toBe(false);
  });

  it('refuses to hash an empty password', () => {
    expect(() => hashPassword('')).toThrow();
  });
});
