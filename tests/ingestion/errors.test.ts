import { describe, expect, it } from 'vitest';

import {
  IngestError,
  ingestErrorFromHttpStatus,
  toIngestError,
} from '@/ingestion';

describe('ingestErrorFromHttpStatus', () => {
  it('classifies 429 as retryable rate limiting', () => {
    const e = ingestErrorFromHttpStatus(429);
    expect(e.code).toBe('RATE_LIMITED');
    expect(e.retryable).toBe(true);
    expect(e.httpStatus).toBe(429);
  });

  it('classifies 5xx as retryable server errors', () => {
    const e = ingestErrorFromHttpStatus(503);
    expect(e.code).toBe('HTTP_SERVER_ERROR');
    expect(e.retryable).toBe(true);
  });

  it('classifies other 4xx as non-retryable client errors', () => {
    const e = ingestErrorFromHttpStatus(404);
    expect(e.code).toBe('HTTP_CLIENT_ERROR');
    expect(e.retryable).toBe(false);
  });
});

describe('toIngestError', () => {
  it('passes classified errors through unchanged', () => {
    const original = new IngestError('SSRF_BLOCKED', 'blocked', {
      retryable: false,
    });
    expect(toIngestError(original)).toBe(original);
  });

  it('maps AbortError to a retryable TIMEOUT', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    const e = toIngestError(abort);
    expect(e.code).toBe('TIMEOUT');
    expect(e.retryable).toBe(true);
  });

  it('maps a network errno to a retryable NETWORK error', () => {
    const err = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    const e = toIngestError(err);
    expect(e.code).toBe('NETWORK');
    expect(e.retryable).toBe(true);
  });

  it('finds a network errno on the cause chain', () => {
    const inner = Object.assign(new Error('inner'), { code: 'ETIMEDOUT' });
    const outer = new Error('outer', { cause: inner });
    expect(toIngestError(outer).code).toBe('NETWORK');
  });

  it('maps anything unexpected to a non-retryable UNKNOWN', () => {
    const e = toIngestError('a string');
    expect(e.code).toBe('UNKNOWN');
    expect(e.retryable).toBe(false);
  });
});
