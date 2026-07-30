import type {
  ApplicationStatus,
  BusinessType,
  DecisionOutcome,
  LoanPurpose,
  ReasonSeverity,
} from './constants';

/**
 * The reason-code catalogue. Shared so the client can render an explanation
 * and an icon per code without duplicating the list.
 */
export const REASON_CODES = [
  // Critical — each of these alone is enough to decline.
  'DATA_INCONSISTENCY',
  'UNSERVICEABLE_EMI',
  'LOW_REVENUE',
  // Contributing negatives.
  'HIGH_EMI_BURDEN',
  'HIGH_LOAN_RATIO',
  'SHORT_TENURE_RISK',
  'LONG_TENURE_RISK',
  'PAN_NAME_MISMATCH',
  // Positives.
  'STRONG_REVENUE_COVERAGE',
  'HEALTHY_TENURE_FIT',
  'COMFORTABLE_LOAN_RATIO',
  // Summary code attached to every score-driven decline.
  'SCORE_BELOW_THRESHOLD',
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

/**
 * A reason is an object rather than a bare string: severity drives colour in
 * the UI, and `pointsImpact` lets the result view sort by what actually moved
 * the score. It also makes the stored audit trail self-explaining.
 */
export interface DecisionReason {
  code: ReasonCode;
  severity: ReasonSeverity;
  message: string;
  /** Signed contribution to the credit score. 0 for hard-rule rejections. */
  pointsImpact: number;
}

/** One row of the score breakdown, kept for the audit trail and the UI. */
export interface ScoreFactor {
  factor: string;
  /** The computed input, e.g. an EMI-to-revenue ratio of 0.24. */
  observedValue: number;
  /** Which threshold band that value fell into. */
  band: string;
  points: number;
}

export interface DerivedMetrics {
  /** Estimated monthly instalment at the assumed nominal rate. */
  estimatedEmi: number;
  /** EMI ÷ monthly revenue. The dominant affordability signal. */
  emiToRevenueRatio: number;
  /** Requested amount ÷ monthly revenue, i.e. months of revenue borrowed. */
  loanToRevenueMultiple: number;
  /** Total repayable over the full tenure. */
  totalRepayable: number;
  annualInterestRatePct: number;
}

export interface DecisionResult {
  outcome: DecisionOutcome;
  creditScore: number;
  reasons: DecisionReason[];
  metrics: DerivedMetrics;
  /** Per-factor breakdown. Empty when a hard rule short-circuited scoring. */
  scoreBreakdown: ScoreFactor[];
  engineVersion: string;
}

/* -------------------------------------------------------------------------- */
/* API response shapes                                                        */
/* -------------------------------------------------------------------------- */

export interface BusinessResource {
  id: string;
  ownerName: string;
  pan: string;
  businessType: BusinessType;
  monthlyRevenue: number;
  createdAt: string;
}

export interface ApplicationResource {
  id: string;
  businessId: string;
  requestedAmount: number;
  tenureMonths: number;
  purpose: LoanPurpose;
  status: ApplicationStatus;
  createdAt: string;
}

export interface DecisionResource {
  id: string;
  applicationId: string;
  outcome: DecisionOutcome;
  creditScore: number;
  estimatedEmi: number;
  reasons: DecisionReason[];
  engineVersion: string;
  evaluatedAt: string;
}

/**
 * `GET /applications/:id/decision` returns this envelope in every state, so a
 * polling client has one shape to handle rather than branching on status code.
 */
export interface DecisionStatusResource {
  applicationId: string;
  status: ApplicationStatus;
  /** Present only once status is DECIDED. */
  decision: DecisionResource | null;
  /** Present only when status is FAILED. */
  failureReason: string | null;
}

/* -------------------------------------------------------------------------- */
/* Envelopes — every response from the API uses one of these two              */
/* -------------------------------------------------------------------------- */

export interface ApiSuccess<T> {
  data: T;
  meta: {
    requestId: string;
  };
}

export interface ApiFieldError {
  field: string;
  message: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details: ApiFieldError[];
    requestId: string;
    /**
     * Present on 409 only. Identifies the record the request collided with, so
     * a client can recover — e.g. a repeat borrower whose PAN already exists
     * gets back the existing business id and can update it rather than
     * starting over.
     */
    conflict?: Record<string, unknown>;
  };
}
