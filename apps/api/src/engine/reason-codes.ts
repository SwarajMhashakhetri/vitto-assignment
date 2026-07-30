import type { DecisionReason, ReasonCode, ReasonSeverity } from '@lds/shared';

/**
 * Factory for reason codes, so that severity is decided in one place per code
 * rather than at each call site (where it would inevitably drift).
 */

const SEVERITY_BY_CODE: Record<ReasonCode, ReasonSeverity> = {
  DATA_INCONSISTENCY: 'CRITICAL',
  UNSERVICEABLE_EMI: 'CRITICAL',
  LOW_REVENUE: 'CRITICAL',
  SCORE_BELOW_THRESHOLD: 'CRITICAL',

  HIGH_EMI_BURDEN: 'WARNING',
  HIGH_LOAN_RATIO: 'WARNING',
  SHORT_TENURE_RISK: 'WARNING',
  LONG_TENURE_RISK: 'WARNING',
  PAN_NAME_MISMATCH: 'WARNING',

  STRONG_REVENUE_COVERAGE: 'POSITIVE',
  HEALTHY_TENURE_FIT: 'POSITIVE',
  COMFORTABLE_LOAN_RATIO: 'POSITIVE',
};

export function reason(
  code: ReasonCode,
  message: string,
  pointsImpact: number = 0,
): DecisionReason {
  return {
    code,
    severity: SEVERITY_BY_CODE[code],
    message,
    pointsImpact,
  };
}

/** Formats rupee figures the way an Indian applicant expects to read them. */
export function formatInr(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

/** 0.2437 -> "24.4%" */
export function formatPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}
