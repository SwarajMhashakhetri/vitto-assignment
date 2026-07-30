/**
 * Domain vocabulary shared by the API and the web client.
 *
 * These live in the shared package rather than in either app so that a new
 * business type or loan purpose cannot be added to the form without the
 * server accepting it, or vice versa.
 */

export const BUSINESS_TYPES = ['RETAIL', 'MANUFACTURING', 'SERVICES'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

/**
 * A fixed purpose taxonomy rather than free text. Lenders report loan purpose
 * to regulators in fixed buckets, and a closed set keeps the field usable as a
 * scoring signal later without a text-classification step.
 */
export const LOAN_PURPOSES = [
  'WORKING_CAPITAL',
  'INVENTORY_PURCHASE',
  'EQUIPMENT_PURCHASE',
  'BUSINESS_EXPANSION',
  'DEBT_CONSOLIDATION',
  'OTHER',
] as const;
export type LoanPurpose = (typeof LOAN_PURPOSES)[number];

export const APPLICATION_STATUSES = ['QUEUED', 'PROCESSING', 'DECIDED', 'FAILED'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const DECISION_OUTCOMES = ['APPROVED', 'REJECTED'] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];

export const REASON_SEVERITIES = ['CRITICAL', 'WARNING', 'INFO', 'POSITIVE'] as const;
export type ReasonSeverity = (typeof REASON_SEVERITIES)[number];

/** Human-readable labels, kept next to the codes so the UI has no second copy. */
export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  RETAIL: 'Retail / Trading',
  MANUFACTURING: 'Manufacturing',
  SERVICES: 'Services',
};

export const LOAN_PURPOSE_LABELS: Record<LoanPurpose, string> = {
  WORKING_CAPITAL: 'Working capital',
  INVENTORY_PURCHASE: 'Inventory purchase',
  EQUIPMENT_PURCHASE: 'Equipment purchase',
  BUSINESS_EXPANSION: 'Business expansion',
  DEBT_CONSOLIDATION: 'Debt consolidation',
  OTHER: 'Other',
};

/**
 * Input bounds. These are *format* limits enforced at the API boundary, not
 * credit policy — a ₹5Cr request against ₹10L revenue is well inside these
 * bounds and is rejected by the decision engine instead, with a reason code.
 * See README, "Validation errors vs. credit rejections".
 */
export const INPUT_LIMITS = {
  /** ₹1,000 — below this the figure is almost certainly a typo or a test value. */
  MIN_MONTHLY_REVENUE: 1_000,
  /** ₹100 Cr — an MSME by definition is far below this; guards against overflow. */
  MAX_MONTHLY_REVENUE: 1_000_000_000,
  /** ₹10,000 — smaller than any commercially sensible business loan. */
  MIN_LOAN_AMOUNT: 10_000,
  MAX_LOAN_AMOUNT: 1_000_000_000,
  MIN_TENURE_MONTHS: 1,
  /** 84 months (7 years) is the practical ceiling for unsecured MSME credit. */
  MAX_TENURE_MONTHS: 84,
  MAX_OWNER_NAME_LENGTH: 120,
} as const;

/**
 * PAN is `AAAAA9999A`: five letters, four digits, one letter.
 * The 4th character encodes the holder type, which we validate separately so
 * the error message can say *which* part is wrong.
 */
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** 4th character of a PAN: the type of the holder. */
/**
 * Nominal annual rate used to estimate instalments, representative of
 * unsecured MSME lending in India (typically 16–24%).
 *
 * Shared rather than server-only because the client quotes it to the applicant
 * alongside the estimated EMI — it is disclosed information, not policy the
 * borrower should not see. The engine re-exports it from config/scoring.ts so
 * the credit policy still reads as one document.
 */
export const ANNUAL_INTEREST_RATE_PCT = 18;

export const PAN_HOLDER_TYPES: Record<string, string> = {
  P: 'Individual',
  C: 'Company',
  H: 'Hindu Undivided Family',
  F: 'Firm / LLP',
  A: 'Association of Persons',
  T: 'Trust',
  B: 'Body of Individuals',
  L: 'Local Authority',
  J: 'Artificial Juridical Person',
  G: 'Government',
};
