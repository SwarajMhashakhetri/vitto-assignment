import type { DecisionReason, DecisionResult, DerivedMetrics, ScoreFactor } from '@lds/shared';
import { calculateEmi, calculateTotalRepayable } from '@lds/shared';
import {
  ANNUAL_INTEREST_RATE_PCT,
  APPROVAL_THRESHOLD,
  ENGINE_VERSION,
  SCORE_RANGE,
} from '../config/scoring';
import { formatInr, reason } from './reason-codes';
import { FACTORS } from './rules/factors';
import { evaluateHardRules } from './rules/hard-rules';
import type { EvaluationInput } from './types';

export type { EvaluationInput } from './types';

/**
 * The decision engine.
 *
 * This function is pure: same input, same output, always. It performs no I/O,
 * touches no database, reads no clock and no environment. That is a deliberate
 * constraint — it means the entire credit policy can be exercised in unit
 * tests with no infrastructure at all, and it means a decision can be exactly
 * reproduced later from the stored inputs.
 *
 * The evaluation runs in three stages:
 *
 *   1. Derive metrics (EMI, ratios) from the raw inputs.
 *   2. Apply hard rules. If any fires, reject immediately at the floor score —
 *      no amount of positive scoring may override a policy floor.
 *   3. Otherwise, sum the weighted factors and compare against the threshold.
 */
export function evaluate(input: EvaluationInput): DecisionResult {
  const metrics = deriveMetrics(input);

  const ctx = {
    input,
    estimatedEmi: metrics.estimatedEmi,
    emiToRevenueRatio: metrics.emiToRevenueRatio,
    loanToRevenueMultiple: metrics.loanToRevenueMultiple,
  };

  /* Stage 2 — hard rules short-circuit the scorecard entirely. */
  const hardRuleFailures = evaluateHardRules(ctx);
  if (hardRuleFailures.length > 0) {
    return {
      outcome: 'REJECTED',
      creditScore: SCORE_RANGE.MIN,
      reasons: hardRuleFailures,
      metrics,
      // Empty by design: the score was never computed, so presenting a
      // breakdown would imply a calculation that did not happen.
      scoreBreakdown: [],
      engineVersion: ENGINE_VERSION,
    };
  }

  /* Stage 3 — weighted scorecard. */
  const scoreBreakdown: ScoreFactor[] = [];
  const reasons: DecisionReason[] = [];
  let rawScore = SCORE_RANGE.BASE;

  for (const factor of FACTORS) {
    const { breakdown, reasons: factorReasons } = factor(ctx);
    rawScore += breakdown.points;
    scoreBreakdown.push(breakdown);
    reasons.push(...factorReasons);
  }

  const creditScore = clamp(rawScore, SCORE_RANGE.MIN, SCORE_RANGE.MAX);
  const outcome = creditScore >= APPROVAL_THRESHOLD ? 'APPROVED' : 'REJECTED';

  // On a decline, lead with a summary code so the headline reason is never
  // just an incidental warning.
  if (outcome === 'REJECTED') {
    reasons.unshift(
      reason(
        'SCORE_BELOW_THRESHOLD',
        `The assessed credit score of ${creditScore} is below the minimum of ${APPROVAL_THRESHOLD} required for approval.`,
      ),
    );
  }

  return {
    outcome,
    creditScore,
    // Largest absolute impact first, so the UI leads with what actually
    // decided the application rather than with whatever ran first.
    reasons: sortByImpact(reasons),
    metrics,
    scoreBreakdown,
    engineVersion: ENGINE_VERSION,
  };
}

/**
 * Derived affordability metrics. Exported because the web client shows the
 * estimated EMI live as the user types, using the same maths the engine will
 * apply — so the number on the form is the number that gets scored.
 */
export function deriveMetrics(
  input: Pick<EvaluationInput, 'requestedAmount' | 'tenureMonths' | 'monthlyRevenue'>,
): DerivedMetrics {
  const estimatedEmi = calculateEmi(
    input.requestedAmount,
    ANNUAL_INTEREST_RATE_PCT,
    input.tenureMonths,
  );

  return {
    estimatedEmi,
    emiToRevenueRatio: estimatedEmi / input.monthlyRevenue,
    loanToRevenueMultiple: input.requestedAmount / input.monthlyRevenue,
    totalRepayable: calculateTotalRepayable(estimatedEmi, input.tenureMonths),
    annualInterestRatePct: ANNUAL_INTEREST_RATE_PCT,
  };
}

/**
 * The largest loan this applicant would clear the threshold for, at the same
 * tenure — found by binary search over the engine itself rather than by
 * inverting the scorecard by hand, so it cannot drift when thresholds change.
 *
 * Returns null when no amount within policy would be approved.
 */
export function findMaxApprovableAmount(
  input: EvaluationInput,
  { minAmount = 10_000, tolerance = 1_000 }: { minAmount?: number; tolerance?: number } = {},
): number | null {
  if (evaluate({ ...input, requestedAmount: minAmount }).outcome !== 'APPROVED') {
    return null;
  }

  let low = minAmount;
  let high = input.requestedAmount;

  // If the requested amount is itself approvable there is nothing to suggest.
  if (evaluate(input).outcome === 'APPROVED') return input.requestedAmount;

  while (high - low > tolerance) {
    const mid = Math.floor((low + high) / 2);
    if (evaluate({ ...input, requestedAmount: mid }).outcome === 'APPROVED') {
      low = mid;
    } else {
      high = mid;
    }
  }

  // Round down to a figure a human would actually be offered.
  return Math.floor(low / 1_000) * 1_000;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** CRITICAL first, then by absolute point impact descending. */
function sortByImpact(reasons: DecisionReason[]): DecisionReason[] {
  const severityRank = { CRITICAL: 0, WARNING: 1, POSITIVE: 2, INFO: 3 } as const;

  return [...reasons].sort((a, b) => {
    const bySeverity = severityRank[a.severity] - severityRank[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return Math.abs(b.pointsImpact) - Math.abs(a.pointsImpact);
  });
}

/** Re-exported so callers do not need to reach into the config module. */
export { APPROVAL_THRESHOLD, ENGINE_VERSION, SCORE_RANGE };
export { formatInr };
