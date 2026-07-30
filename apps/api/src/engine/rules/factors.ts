import type { DecisionReason, ScoreFactor } from '@lds/shared';
import {
  COMFORTABLE_LOAN_MULTIPLE,
  EMI_TO_REVENUE_BANDS,
  HIGH_EMI_BURDEN_RATIO,
  HIGH_LOAN_RATIO_MULTIPLE,
  LOAN_TO_REVENUE_BANDS,
  LOW_REVENUE_THRESHOLD,
  PAN_NAME_MISMATCH_POINTS,
  REVENUE_SCALE_BANDS,
  SECTOR_ADJUSTMENTS,
  STRONG_COVERAGE_RATIO,
  TENURE_BANDS,
} from '../../config/scoring';
import { formatInr, formatPct, reason } from '../reason-codes';
import type { EvaluationInput } from '../types';

/**
 * The weighted scorecard.
 *
 * Each factor is an independent function returning both its score contribution
 * and any reason codes it triggered. They are summed by the engine; none of
 * them knows about the others, and none of them knows the final threshold.
 * Adding a seventh factor means writing one function and adding it to the
 * FACTORS array at the bottom — no existing code changes.
 */

export interface FactorContext {
  input: EvaluationInput;
  estimatedEmi: number;
  emiToRevenueRatio: number;
  loanToRevenueMultiple: number;
}

export interface FactorOutcome {
  breakdown: ScoreFactor;
  reasons: DecisionReason[];
}

type Factor = (ctx: FactorContext) => FactorOutcome;

/* -------------------------------------------------------------------------- */

/** Factor 1 — affordability. The heaviest-weighted signal in the scorecard. */
const emiToRevenueFactor: Factor = ({ input, estimatedEmi, emiToRevenueRatio }) => {
  // Bands are ordered ascending, so the first match is the correct one.
  const matched =
    EMI_TO_REVENUE_BANDS.find((b) => emiToRevenueRatio <= b.maxRatio) ??
    EMI_TO_REVENUE_BANDS[EMI_TO_REVENUE_BANDS.length - 1]!;

  const reasons: DecisionReason[] = [];

  if (emiToRevenueRatio <= STRONG_COVERAGE_RATIO) {
    reasons.push(
      reason(
        'STRONG_REVENUE_COVERAGE',
        `The estimated instalment of ${formatInr(estimatedEmi)} is only ${formatPct(
          emiToRevenueRatio,
        )} of monthly revenue, leaving comfortable headroom.`,
        matched.points,
      ),
    );
  } else if (emiToRevenueRatio > HIGH_EMI_BURDEN_RATIO) {
    reasons.push(
      reason(
        'HIGH_EMI_BURDEN',
        `The estimated instalment of ${formatInr(estimatedEmi)} consumes ${formatPct(
          emiToRevenueRatio,
        )} of monthly revenue (${formatInr(
          input.monthlyRevenue,
        )}), leaving little room for operating costs.`,
        matched.points,
      ),
    );
  }

  return {
    breakdown: {
      factor: 'EMI to revenue',
      observedValue: Number(emiToRevenueRatio.toFixed(4)),
      band: matched.band,
      points: matched.points,
    },
    reasons,
  };
};

/** Factor 2 — exposure relative to the size of the business. */
const loanToRevenueFactor: Factor = ({ input, loanToRevenueMultiple }) => {
  const matched =
    LOAN_TO_REVENUE_BANDS.find((b) => loanToRevenueMultiple <= b.maxMultiple) ??
    LOAN_TO_REVENUE_BANDS[LOAN_TO_REVENUE_BANDS.length - 1]!;

  const reasons: DecisionReason[] = [];

  if (loanToRevenueMultiple <= COMFORTABLE_LOAN_MULTIPLE) {
    reasons.push(
      reason(
        'COMFORTABLE_LOAN_RATIO',
        `The requested amount is ${loanToRevenueMultiple.toFixed(
          1,
        )}× monthly revenue — a modest exposure for a business of this size.`,
        matched.points,
      ),
    );
  } else if (loanToRevenueMultiple > HIGH_LOAN_RATIO_MULTIPLE) {
    reasons.push(
      reason(
        'HIGH_LOAN_RATIO',
        `The requested amount of ${formatInr(
          input.requestedAmount,
        )} is ${loanToRevenueMultiple.toFixed(1)}× monthly revenue, a large exposure relative to the size of the business.`,
        matched.points,
      ),
    );
  }

  return {
    breakdown: {
      factor: 'Loan to revenue multiple',
      observedValue: Number(loanToRevenueMultiple.toFixed(2)),
      band: matched.band,
      points: matched.points,
    },
    reasons,
  };
};

/** Factor 3 — tenure. Risk here is non-monotonic; see config/scoring.ts. */
const tenureFactor: Factor = ({ input }) => {
  const { tenureMonths } = input;
  const reasons: DecisionReason[] = [];

  let points: number;
  let band: string;

  if (tenureMonths >= TENURE_BANDS.IDEAL_MIN && tenureMonths <= TENURE_BANDS.IDEAL_MAX) {
    points = TENURE_BANDS.IDEAL_POINTS;
    band = `${TENURE_BANDS.IDEAL_MIN}–${TENURE_BANDS.IDEAL_MAX} months (ideal)`;
    reasons.push(
      reason(
        'HEALTHY_TENURE_FIT',
        `A ${tenureMonths}-month tenure sits in the range where repayment is spread comfortably without extending the exposure too far.`,
        points,
      ),
    );
  } else if (tenureMonths < TENURE_BANDS.ACCEPTABLE_MIN) {
    points = TENURE_BANDS.TOO_SHORT_POINTS;
    band = `< ${TENURE_BANDS.ACCEPTABLE_MIN} months (too short)`;
    reasons.push(
      reason(
        'SHORT_TENURE_RISK',
        `A ${tenureMonths}-month tenure concentrates repayment into very few instalments, leaving no room to absorb a weak month.`,
        points,
      ),
    );
  } else if (tenureMonths > TENURE_BANDS.ACCEPTABLE_MAX) {
    points = TENURE_BANDS.TOO_LONG_POINTS;
    band = `> ${TENURE_BANDS.ACCEPTABLE_MAX} months (too long)`;
    reasons.push(
      reason(
        'LONG_TENURE_RISK',
        `A ${tenureMonths}-month tenure extends an unsecured exposure beyond the horizon over which this business can be reliably forecast.`,
        points,
      ),
    );
  } else {
    points = TENURE_BANDS.ACCEPTABLE_POINTS;
    band = 'acceptable';
  }

  return {
    breakdown: { factor: 'Tenure fit', observedValue: tenureMonths, band, points },
    reasons,
  };
};

/** Factor 4 — scale, as a proxy for resilience to shocks. */
const revenueScaleFactor: Factor = ({ input }) => {
  const { monthlyRevenue } = input;
  const matched =
    REVENUE_SCALE_BANDS.find((b) => monthlyRevenue >= b.minRevenue) ??
    REVENUE_SCALE_BANDS[REVENUE_SCALE_BANDS.length - 1]!;

  const reasons: DecisionReason[] = [];

  // Note: revenue below the *hard rule* floor never reaches this code. This
  // covers the softer band between the floor and a comfortable scale.
  if (monthlyRevenue < LOW_REVENUE_THRESHOLD) {
    reasons.push(
      reason(
        'LOW_REVENUE',
        `Monthly revenue of ${formatInr(monthlyRevenue)} is modest for a term loan; lenders typically look for at least ${formatInr(
          LOW_REVENUE_THRESHOLD,
        )}.`,
        matched.points,
      ),
    );
  }

  return {
    breakdown: {
      factor: 'Revenue scale',
      observedValue: monthlyRevenue,
      band: matched.band,
      points: matched.points,
    },
    reasons,
  };
};

/** Factor 5 — sector. Capped at ±20 so it can never decide a file alone. */
const sectorFactor: Factor = ({ input }) => {
  const points = SECTOR_ADJUSTMENTS[input.businessType];

  return {
    breakdown: {
      factor: 'Sector adjustment',
      observedValue: points,
      band: input.businessType,
      points,
    },
    reasons: [],
  };
};

/**
 * Factor 6 — PAN/name consistency.
 *
 * For an individual PAN the 5th character is the first letter of the holder's
 * surname. Comparing it against the surname on the application is a cheap
 * consistency check that catches transposed or borrowed PANs.
 *
 * Skipped entirely for non-individual PANs and for mononyms, and weighted
 * lightly, because a legal name change or an unconventional name order is a
 * far more likely explanation than fraud.
 */
const panNameConsistencyFactor: Factor = ({ input }) => {
  const isIndividualPan = input.pan.charAt(3) === 'P';
  const nameParts = input.ownerName.trim().split(/\s+/).filter(Boolean);
  const surname = nameParts.length > 1 ? nameParts[nameParts.length - 1]! : null;

  const notApplicable: FactorOutcome = {
    breakdown: {
      factor: 'PAN / name consistency',
      observedValue: 0,
      band: 'not applicable',
      points: 0,
    },
    reasons: [],
  };

  if (!isIndividualPan || !surname) return notApplicable;

  const panSurnameInitial = input.pan.charAt(4);
  const actualSurnameInitial = surname.charAt(0).toUpperCase();

  if (panSurnameInitial === actualSurnameInitial) {
    return {
      breakdown: {
        factor: 'PAN / name consistency',
        observedValue: 0,
        band: 'consistent',
        points: 0,
      },
      reasons: [],
    };
  }

  return {
    breakdown: {
      factor: 'PAN / name consistency',
      observedValue: PAN_NAME_MISMATCH_POINTS,
      band: 'mismatch',
      points: PAN_NAME_MISMATCH_POINTS,
    },
    reasons: [
      reason(
        'PAN_NAME_MISMATCH',
        `The PAN suggests a surname beginning with "${panSurnameInitial}", but the application gives "${surname}". This may be a typo — it does not block approval on its own.`,
        PAN_NAME_MISMATCH_POINTS,
      ),
    ],
  };
};

export const FACTORS: Factor[] = [
  emiToRevenueFactor,
  loanToRevenueFactor,
  tenureFactor,
  revenueScaleFactor,
  sectorFactor,
  panNameConsistencyFactor,
];
