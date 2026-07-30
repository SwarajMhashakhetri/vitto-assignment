import type { DecisionReason } from '@lds/shared';
import { HARD_RULES } from '../../config/scoring';
import { formatInr, formatPct, reason } from '../reason-codes';
import type { EvaluationInput } from '../types';

/**
 * Hard rules — policy floors that no amount of positive scoring may override.
 *
 * These are deliberately kept separate from the weighted factors. A scorecard
 * expresses "how much worse does this make the file"; a hard rule expresses
 * "this file is not lendable, full stop". Mixing the two is how scorecards end
 * up approving applications nobody intended to approve, because enough small
 * positives outvoted one disqualifying fact.
 *
 * Every rule here returns a CRITICAL reason and short-circuits scoring.
 */

export interface HardRuleContext {
  input: EvaluationInput;
  estimatedEmi: number;
  emiToRevenueRatio: number;
  loanToRevenueMultiple: number;
}

type HardRule = (ctx: HardRuleContext) => DecisionReason | null;

/**
 * A request worth more than three years of gross revenue. Treated as a data
 * integrity problem rather than a credit problem: at this ratio the likeliest
 * explanations are a mistyped figure or a fabricated one.
 */
const loanGrosslyDisproportionate: HardRule = ({ input, loanToRevenueMultiple }) => {
  if (loanToRevenueMultiple <= HARD_RULES.MAX_LOAN_TO_REVENUE_MULTIPLE) return null;

  return reason(
    'DATA_INCONSISTENCY',
    `The requested amount of ${formatInr(input.requestedAmount)} is ${loanToRevenueMultiple.toFixed(
      1,
    )}× monthly revenue of ${formatInr(input.monthlyRevenue)} — over ${
      HARD_RULES.MAX_LOAN_TO_REVENUE_MULTIPLE
    }× (more than three years of total revenue). Please confirm both figures are correct.`,
  );
};

/**
 * The instalment consumes all revenue or more. Not survivable at any margin.
 */
const emiExceedsRevenue: HardRule = ({ input, estimatedEmi, emiToRevenueRatio }) => {
  if (emiToRevenueRatio < HARD_RULES.MAX_EMI_TO_REVENUE_RATIO) return null;

  return reason(
    'UNSERVICEABLE_EMI',
    `The estimated instalment of ${formatInr(estimatedEmi)} per month is ${formatPct(
      emiToRevenueRatio,
    )} of monthly revenue (${formatInr(
      input.monthlyRevenue,
    )}). The loan cannot be serviced from revenue alone.`,
  );
};

/** Below the revenue floor at which a formal term loan is the right product. */
const belowRevenueFloor: HardRule = ({ input }) => {
  if (input.monthlyRevenue >= HARD_RULES.MIN_MONTHLY_REVENUE) return null;

  return reason(
    'LOW_REVENUE',
    `Monthly revenue of ${formatInr(input.monthlyRevenue)} is below the minimum of ${formatInr(
      HARD_RULES.MIN_MONTHLY_REVENUE,
    )} required for a business term loan.`,
  );
};

/**
 * Order matters for readability of the result, not for correctness: all
 * matching rules are reported, so an applicant sees every blocker at once
 * rather than fixing one and discovering the next.
 */
const RULES: HardRule[] = [belowRevenueFloor, loanGrosslyDisproportionate, emiExceedsRevenue];

export function evaluateHardRules(ctx: HardRuleContext): DecisionReason[] {
  return RULES.map((rule) => rule(ctx)).filter((r): r is DecisionReason => r !== null);
}
