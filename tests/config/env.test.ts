import { describe, expect, it } from 'vitest';

import { isAiConfigured, parseEnv, requireAiConfig } from '@/config/env';

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

describe('AI provider configuration (Stage 6)', () => {
  it('treats AI as unconfigured when AI_PROVIDER is absent', () => {
    const env = parseEnv({});
    expect(isAiConfigured(env)).toBe(false);
    expect(() => requireAiConfig(env)).toThrowError(/AI provider is not/);
  });

  it('resolves the fake provider without a key', () => {
    const env = parseEnv({ AI_PROVIDER: 'fake' });
    expect(isAiConfigured(env)).toBe(true);
    const config = requireAiConfig(env);
    expect(config.provider).toBe('fake');
    expect(config.apiKey).toBeUndefined();
  });

  it('requires a key and model for the anthropic provider', () => {
    expect(() =>
      requireAiConfig(parseEnv({ AI_PROVIDER: 'anthropic' })),
    ).toThrowError(/AI_API_KEY/);
    expect(() =>
      requireAiConfig(parseEnv({ AI_PROVIDER: 'anthropic', AI_API_KEY: 'k' })),
    ).toThrowError(/AI_MODEL/);
  });

  it('resolves a complete anthropic configuration', () => {
    const config = requireAiConfig(
      parseEnv({
        AI_PROVIDER: 'anthropic',
        AI_API_KEY: 'secret',
        AI_MODEL: 'claude-test',
        AI_BASE_URL: 'https://proxy.example.com',
      }),
    );
    expect(config).toEqual({
      provider: 'anthropic',
      apiKey: 'secret',
      model: 'claude-test',
      baseUrl: 'https://proxy.example.com',
    });
  });
});
