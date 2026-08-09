import { describe, expect, it } from 'vitest';

import { deriveHealth, type HealthState } from '@/ingestion';

describe('deriveHealth', () => {
  it('marks a fresh Source HEALTHY on first success', () => {
    expect(
      deriveHealth({ failureCount: 0, healthStatus: 'UNKNOWN' }, 'success'),
    ).toEqual({ failureCount: 0, healthStatus: 'HEALTHY' });
  });

  it('degrades on the first failure', () => {
    expect(
      deriveHealth({ failureCount: 0, healthStatus: 'HEALTHY' }, 'failure'),
    ).toEqual({ failureCount: 1, healthStatus: 'DEGRADED' });
  });

  it('escalates to FAILING at the threshold', () => {
    expect(
      deriveHealth({ failureCount: 2, healthStatus: 'DEGRADED' }, 'failure'),
    ).toEqual({ failureCount: 3, healthStatus: 'FAILING' });
  });

  it('recovers to HEALTHY and clears the streak on success', () => {
    expect(
      deriveHealth({ failureCount: 7, healthStatus: 'FAILING' }, 'success'),
    ).toEqual({ failureCount: 0, healthStatus: 'HEALTHY' });
  });

  it('never auto-disables — a broken Source stays FAILING, not DISABLED', () => {
    let state: HealthState = { failureCount: 0, healthStatus: 'HEALTHY' };
    for (let i = 0; i < 20; i += 1) {
      state = deriveHealth(state, 'failure');
    }
    expect(state.healthStatus).toBe('FAILING');
  });

  it('keeps an editorially DISABLED Source disabled regardless of outcome', () => {
    expect(
      deriveHealth({ failureCount: 0, healthStatus: 'DISABLED' }, 'success'),
    ).toEqual({ failureCount: 0, healthStatus: 'DISABLED' });
    expect(
      deriveHealth({ failureCount: 1, healthStatus: 'DISABLED' }, 'failure'),
    ).toEqual({ failureCount: 1, healthStatus: 'DISABLED' });
  });
});
