import type { HealthStatus } from '@/domain/enums';

/**
 * Source health derivation.
 *
 * Health is a deterministic function of the previous state and the latest fetch
 * outcome, kept pure so it is trivially testable and identical everywhere it is
 * applied. Invariants (docs/CURRENT_STAGE Stage 3):
 *  - a broken Source must never silently disappear — failures degrade health but
 *    never auto-DISABLE or delete a Source (DISABLED is an editorial action);
 *  - a Source already DISABLED stays DISABLED regardless of fetch results;
 *  - a successful fetch (including a 304 Not Modified) clears the failure streak
 *    and returns the Source to HEALTHY.
 *
 * Thresholds are consecutive-failure counts; tune here in one place.
 */

export const HEALTH_DEGRADED_THRESHOLD = 1;
export const HEALTH_FAILING_THRESHOLD = 3;

export type FetchOutcome = 'success' | 'failure';

export interface HealthState {
  failureCount: number;
  healthStatus: HealthStatus;
}

/**
 * Compute the next {@link HealthState} from the previous one and an outcome.
 * `success` resets the failure streak; `failure` increments it and maps the new
 * streak length onto HEALTHY → DEGRADED → FAILING.
 */
export function deriveHealth(
  previous: HealthState,
  outcome: FetchOutcome,
): HealthState {
  // Editorial DISABLED is sticky; ingestion never changes it.
  if (previous.healthStatus === 'DISABLED') {
    return { failureCount: previous.failureCount, healthStatus: 'DISABLED' };
  }

  if (outcome === 'success') {
    return { failureCount: 0, healthStatus: 'HEALTHY' };
  }

  const failureCount = previous.failureCount + 1;
  return { failureCount, healthStatus: statusForFailures(failureCount) };
}

function statusForFailures(failureCount: number): HealthStatus {
  if (failureCount >= HEALTH_FAILING_THRESHOLD) return 'FAILING';
  if (failureCount >= HEALTH_DEGRADED_THRESHOLD) return 'DEGRADED';
  return 'HEALTHY';
}
