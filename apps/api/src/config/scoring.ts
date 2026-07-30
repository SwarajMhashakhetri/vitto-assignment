/**
 * The entire credit policy of this system, in one file.
 *
 * Every number the decision engine uses is declared here and nowhere else, so
 * that (a) retuning the scorecard never means hunting through business logic,
 * and (b) the README's threshold tables can be checked against a single
 * source. If you disagree with a decision this system made, the disagreement
 * is with a constant on this page.
 *
 * Bump ENGINE_VERSION whenever any value below changes: it is stored on every
 * decision row so historical decisions stay interpretable after a retune.
 */

export const ENGINE_VERSION = '1.0.0';

/* -------------------------------------------------------------------------- */
/* Score scale                                                                */
/* -------------------------------------------------------------------------- */

/**
 * 300–900 deliberately mirrors the CIBIL range that Indian lenders and
 * borrowers already read fluently. A borrower who sees 720 has an intuition
 * for it that a 0–100 or 0–1 score would not give them.
 */
export const SCORE_RANGE = {
  MIN: 300,
  MAX: 900,
  /**
   * Every application starts here and is moved by the factors below. 550 sits
   * below the approval threshold on purpose: an applicant must earn approval
   * through positive signals rather than merely avoiding negative ones.
   */
  BASE: 550,
} as const;

/**
 * At 650 the score sits ~17% above base. Calibrating this against real
 * portfolio default data is the first thing a production system would do; the
 * value here is chosen so that the reference cases in the README land where a
 * credit officer would expect them to.
 */
export const APPROVAL_THRESHOLD = 650;

/* -------------------------------------------------------------------------- */
/* Interest assumption                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A flat 18% p.a. nominal rate, representative of unsecured MSME lending in
 * India (typically 16–24% depending on the lender and the borrower's profile).
 *
 * Defined in the shared package because the web client quotes it to the
 * applicant, and re-exported here so this file still reads as the complete
 * credit policy.
 *
 * Known simplification: a real engine prices the rate off the very risk band it
 * is computing, so rate and score are mutually dependent and solved together.
 * Holding the rate flat breaks that circularity, at the cost of over-stating
 * affordability for weak applicants and under-stating it for strong ones.
 */
export { ANNUAL_INTEREST_RATE_PCT } from '@lds/shared';

/* -------------------------------------------------------------------------- */
/* Hard rules — evaluated before scoring, and short-circuit it entirely       */
/* -------------------------------------------------------------------------- */

export const HARD_RULES = {
  /**
   * A request above 36× monthly revenue is more than three years of *gross*
   * revenue — not profit — borrowed at once. At that point the figures are
   * more likely to be a data-entry error or fabricated than a real ask, which
   * is why the reason code is DATA_INCONSISTENCY rather than HIGH_LOAN_RATIO.
   *
   * The brief's own example, ₹10L/month revenue against a ₹5Cr request, is 50×
   * and trips this rule.
   */
  MAX_LOAN_TO_REVENUE_MULTIPLE: 36,

  /**
   * If the instalment alone meets or exceeds *all* revenue, the loan cannot be
   * serviced even at a 100% margin with zero costs. No score should rescue it.
   */
  MAX_EMI_TO_REVENUE_RATIO: 1.0,

  /**
   * ₹25,000/month of revenue is below the level at which a formal term loan is
   * a sensible product; such a borrower is better served by microfinance.
   */
  MIN_MONTHLY_REVENUE: 25_000,
} as const;

/* -------------------------------------------------------------------------- */
/* Factor 1 — EMI to revenue (FOIR proxy)                                     */
/* -------------------------------------------------------------------------- */

/**
 * Affordability is the single best predictor of repayment, so this factor
 * carries the widest spread (+150 to −220) and can move a decision on its own.
 *
 * The bands approximate FOIR (fixed-obligation-to-income ratio) practice.
 * Note that we compare against *revenue*, not profit, because revenue is all
 * this system collects — see the "Assumptions" section of the README. A retail
 * business on 8% net margin and a services business on 40% are treated
 * identically here, which is the largest single weakness in this scorecard.
 */
export const EMI_TO_REVENUE_BANDS = [
  { maxRatio: 0.1, points: 150, band: '≤ 10%' },
  { maxRatio: 0.2, points: 100, band: '10–20%' },
  { maxRatio: 0.3, points: 40, band: '20–30%' },
  { maxRatio: 0.4, points: -40, band: '30–40%' },
  { maxRatio: 0.5, points: -120, band: '40–50%' },
  { maxRatio: Infinity, points: -220, band: '> 50%' },
] as const;

/** At or below this ratio the applicant earns a positive reason code. */
export const STRONG_COVERAGE_RATIO = 0.1;
/** Above this ratio a HIGH_EMI_BURDEN warning is attached. */
export const HIGH_EMI_BURDEN_RATIO = 0.3;

/* -------------------------------------------------------------------------- */
/* Factor 2 — Loan size as a multiple of monthly revenue                      */
/* -------------------------------------------------------------------------- */

/**
 * Distinct from Factor 1: a long tenure can make a very large loan look
 * affordable month-to-month while still representing an outsized exposure
 * relative to the size of the business. This factor prices that exposure.
 */
export const LOAN_TO_REVENUE_BANDS = [
  { maxMultiple: 3, points: 90, band: '≤ 3×' },
  { maxMultiple: 6, points: 50, band: '3–6×' },
  { maxMultiple: 12, points: 0, band: '6–12×' },
  { maxMultiple: 24, points: -80, band: '12–24×' },
  { maxMultiple: Infinity, points: -200, band: '> 24×' },
] as const;

export const COMFORTABLE_LOAN_MULTIPLE = 3;
export const HIGH_LOAN_RATIO_MULTIPLE = 12;

/* -------------------------------------------------------------------------- */
/* Factor 3 — Tenure fit                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Risk is non-monotonic in tenure, so this cannot be a simple gradient:
 *
 *  - Very short tenures concentrate repayment into few, large instalments —
 *    repayment shock, and little room to recover from one bad month.
 *  - Very long tenures extend an *unsecured* exposure past the horizon over
 *    which anyone can forecast a small business, and past the point where the
 *    revenue figure on this application means anything.
 *
 * 12–36 months is the band where MSME term lending actually clusters.
 */
export const TENURE_BANDS = {
  IDEAL_MIN: 12,
  IDEAL_MAX: 36,
  ACCEPTABLE_MIN: 6,
  ACCEPTABLE_MAX: 48,
  IDEAL_POINTS: 60,
  ACCEPTABLE_POINTS: 10,
  TOO_SHORT_POINTS: -60,
  TOO_LONG_POINTS: -70,
} as const;

/* -------------------------------------------------------------------------- */
/* Factor 4 — Revenue scale                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Larger businesses survive shocks that kill smaller ones, independent of how
 * affordable this particular loan looks. This factor is a proxy for that
 * resilience — and for the reality that reporting quality improves with size.
 */
export const REVENUE_SCALE_BANDS = [
  { minRevenue: 1_000_000, points: 80, band: '≥ ₹10L/month' },
  { minRevenue: 500_000, points: 50, band: '₹5L–10L/month' },
  { minRevenue: 100_000, points: 20, band: '₹1L–5L/month' },
  { minRevenue: 50_000, points: 0, band: '₹50k–1L/month' },
  { minRevenue: 0, points: -100, band: '< ₹50k/month' },
] as const;

export const LOW_REVENUE_THRESHOLD = 50_000;

/* -------------------------------------------------------------------------- */
/* Factor 5 — Sector                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Capped at ±20 — a twentieth of the EMI factor's spread — so that sector can
 * nudge a borderline file but can never decide one on its own.
 *
 * This is a placeholder, and should be read as one. A real weighting comes from
 * observed default rates in the lender's own portfolio, segmented far more
 * finely than three buckets. The ordering here reflects only the generic
 * cash-conversion-cycle argument: services carry low capex and collect fast;
 * retail turns over steadily but on thin margins; manufacturing carries
 * inventory and receivables, so cash flow is lumpiest.
 */
export const SECTOR_ADJUSTMENTS = {
  SERVICES: 20,
  RETAIL: 10,
  MANUFACTURING: 0,
} as const;

/* -------------------------------------------------------------------------- */
/* Factor 6 — PAN / name consistency                                          */
/* -------------------------------------------------------------------------- */

/**
 * The 5th character of an individual PAN is the first letter of the holder's
 * surname. A mismatch against the surname supplied on the application is a
 * genuine (if weak) fraud signal that lenders do check.
 *
 * Applied only to individual PANs (4th character 'P'), because for a company
 * or firm PAN the 5th character encodes the *entity* name, which we do not
 * collect. Weighted small and non-blocking: an applicant who has legally
 * changed their name, or who enters a mononym, should not be declined by it.
 */
export const PAN_NAME_MISMATCH_POINTS = -30;
