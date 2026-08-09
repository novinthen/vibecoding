import { describe, expect, it } from 'vitest';

import { parseEnv } from '@/config/env';

describe('parseEnv', () => {
  it('applies safe defaults when optional variables are absent', () => {
    const env = parseEnv({});

    expect(env.NODE_ENV).toBe('development');
    expect(env.APP_ENV).toBe('local');
    expect(env.NEXT_PUBLIC_APP_NAME).toBe('Vibe Coding News Portal');
  });

  it('accepts valid provided values', () => {
    const env = parseEnv({
      NODE_ENV: 'production',
      APP_ENV: 'preview',
      NEXT_PUBLIC_APP_NAME: 'Custom Publication',
    });

    expect(env.NODE_ENV).toBe('production');
    expect(env.APP_ENV).toBe('preview');
    expect(env.NEXT_PUBLIC_APP_NAME).toBe('Custom Publication');
  });

  it('throws a descriptive error on an invalid enum value', () => {
    expect(() => parseEnv({ NODE_ENV: 'staging' })).toThrowError(
      /Invalid environment variables/,
    );
  });

  it('rejects an empty public app name', () => {
    expect(() => parseEnv({ NEXT_PUBLIC_APP_NAME: '' })).toThrowError(
      /NEXT_PUBLIC_APP_NAME/,
    );
  });
});
