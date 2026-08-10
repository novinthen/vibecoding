import { describe, expect, it, vi } from 'vitest';

import { buildProvider, resolveConfiguredProvider } from '@/ai/config';
import {
  AiProviderError,
  AnthropicProvider,
  codeForHttpStatus,
  extractJson,
  FakeProvider,
  isRetryable,
} from '@/ai/provider';
import type { StructuredRequest } from '@/ai/provider/types';

const REQUEST: StructuredRequest = {
  system: 'system instructions',
  input: 'untrusted input',
  schemaName: 'test',
};

describe('AiProviderError classification', () => {
  it('marks transient categories retryable and deterministic ones not', () => {
    expect(new AiProviderError('RATE_LIMITED', 'x').retryable).toBe(true);
    expect(new AiProviderError('TIMEOUT', 'x').retryable).toBe(true);
    expect(new AiProviderError('NETWORK', 'x').retryable).toBe(true);
    expect(new AiProviderError('SERVER', 'x').retryable).toBe(true);

    expect(new AiProviderError('AUTH', 'x').retryable).toBe(false);
    expect(new AiProviderError('MISCONFIGURED', 'x').retryable).toBe(false);
    expect(new AiProviderError('BAD_REQUEST', 'x').retryable).toBe(false);
    expect(new AiProviderError('UNPARSEABLE_RESPONSE', 'x').retryable).toBe(
      false,
    );
    expect(isRetryable(new Error('plain'))).toBe(false);
  });

  it('maps HTTP status codes to error codes', () => {
    expect(codeForHttpStatus(401)).toBe('AUTH');
    expect(codeForHttpStatus(403)).toBe('AUTH');
    expect(codeForHttpStatus(429)).toBe('RATE_LIMITED');
    expect(codeForHttpStatus(500)).toBe('SERVER');
    expect(codeForHttpStatus(503)).toBe('SERVER');
    expect(codeForHttpStatus(400)).toBe('BAD_REQUEST');
    expect(codeForHttpStatus(404)).toBe('BAD_REQUEST');
  });
});

describe('FakeProvider', () => {
  it('returns a scripted object and records the call', async () => {
    const provider = new FakeProvider({ respondWith: { hello: 'world' } });
    const result = await provider.completeStructured(REQUEST);
    expect(result.parsed).toEqual({ hello: 'world' });
    expect(JSON.parse(result.raw)).toEqual({ hello: 'world' });
    expect(result.provider).toBe('fake');
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.system).toBe('system instructions');
  });

  it('parses a raw JSON string like a real provider', async () => {
    const provider = new FakeProvider({ respondRaw: '{"a":1}' });
    const result = await provider.completeStructured(REQUEST);
    expect(result.parsed).toEqual({ a: 1 });
  });

  it('rejects non-JSON raw output as a non-retryable provider error', async () => {
    const provider = new FakeProvider({ respondRaw: 'not json at all' });
    await expect(provider.completeStructured(REQUEST)).rejects.toMatchObject({
      name: 'AiProviderError',
      code: 'UNPARSEABLE_RESPONSE',
      retryable: false,
    });
  });

  it('throws the scripted error', async () => {
    const provider = new FakeProvider({
      failWith: new AiProviderError('RATE_LIMITED', 'slow down'),
    });
    await expect(provider.completeStructured(REQUEST)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
    });
  });
});

describe('extractJson', () => {
  it('parses a bare JSON object', () => {
    expect(extractJson('{"x":1}')).toEqual({ x: 1 });
  });

  it('parses a fenced json block', () => {
    expect(extractJson('```json\n{"x":2}\n```')).toEqual({ x: 2 });
  });

  it('parses a braced span embedded in prose', () => {
    expect(extractJson('Here you go: {"x":3}. Thanks!')).toEqual({ x: 3 });
  });

  it('returns undefined when there is no JSON object', () => {
    expect(extractJson('no json here')).toBeUndefined();
  });
});

describe('AnthropicProvider (injected fetch, no live calls)', () => {
  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('requires an API key', () => {
    expect(
      () => new AnthropicProvider({ apiKey: '', model: 'm' }),
    ).toThrowError(/API key/);
  });

  it('sends system and input separately and parses the reply', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        content: [{ type: 'text', text: '{"relevance":"RELEVANT"}' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );
    const provider = new AnthropicProvider({
      apiKey: 'secret-key',
      model: 'claude-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await provider.completeStructured(REQUEST);
    expect(result.parsed).toEqual({ relevance: 'RELEVANT' });
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.system).toBe('system instructions');
    expect(body.messages).toEqual([
      { role: 'user', content: 'untrusted input' },
    ]);
    // The untrusted input must never be concatenated into the system field.
    expect(body.system).not.toContain('untrusted input');
  });

  it('classifies a 429 as retryable and never leaks the key', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'rate' }, 429));
    const provider = new AnthropicProvider({
      apiKey: 'super-secret',
      model: 'm',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await provider.completeStructured(REQUEST).then(
      () => {
        throw new Error('expected rejection');
      },
      (error: unknown) => {
        expect(error).toBeInstanceOf(AiProviderError);
        const e = error as AiProviderError;
        expect(e.code).toBe('RATE_LIMITED');
        expect(e.retryable).toBe(true);
        expect(e.message).not.toContain('super-secret');
      },
    );
  });

  it('classifies a 401 as non-retryable AUTH', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 401));
    const provider = new AnthropicProvider({
      apiKey: 'k',
      model: 'm',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(provider.completeStructured(REQUEST)).rejects.toMatchObject({
      code: 'AUTH',
      retryable: false,
    });
  });

  it('rejects a reply with no JSON object as UNPARSEABLE', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ content: [{ type: 'text', text: 'sorry, no' }] }),
    );
    const provider = new AnthropicProvider({
      apiKey: 'k',
      model: 'm',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(provider.completeStructured(REQUEST)).rejects.toMatchObject({
      code: 'UNPARSEABLE_RESPONSE',
    });
  });

  it('maps a transport failure to NETWORK', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    const provider = new AnthropicProvider({
      apiKey: 'k',
      model: 'm',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(provider.completeStructured(REQUEST)).rejects.toMatchObject({
      code: 'NETWORK',
      retryable: true,
    });
  });
});

describe('buildProvider / resolveConfiguredProvider', () => {
  it('builds a fake provider from config', () => {
    const provider = buildProvider({ provider: 'fake', model: 'fake-1' });
    expect(provider.name).toBe('fake');
  });

  it('refuses to build an anthropic provider without a key', () => {
    expect(() =>
      buildProvider({ provider: 'anthropic', model: 'm' }),
    ).toThrowError(AiProviderError);
  });

  it('throws a MISCONFIGURED error when AI is not configured', () => {
    // No AI_PROVIDER in the test environment.
    try {
      resolveConfiguredProvider();
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AiProviderError);
      expect((error as AiProviderError).code).toBe('MISCONFIGURED');
    }
  });
});
