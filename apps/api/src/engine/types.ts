import type { BusinessType, LoanPurpose } from '@lds/shared';

/**
 * Everything the engine needs, and nothing else.
 *
 * Note this is *not* the Prisma model. The engine never sees an entity id, a
 * timestamp, or a database row — it takes plain numbers and returns a verdict.
 * That is what keeps it a pure function, testable without any infrastructure.
 */
export interface EvaluationInput {
  ownerName: string;
  pan: string;
  businessType: BusinessType;
  monthlyRevenue: number;
  requestedAmount: number;
  tenureMonths: number;
  purpose: LoanPurpose;
}
