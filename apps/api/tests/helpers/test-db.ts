import { sql } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { businesses, decisionReasons, decisions, loanApplications } from '../../src/db/schema';

/**
 * Integration-test helpers.
 *
 * These run against the real Postgres from docker-compose rather than a mock.
 * A mocked database would not catch the things most likely to break here — a
 * unique constraint, a cascade, a NUMERIC round trip — which is precisely what
 * these tests exist to cover.
 */

/** Truncates every table. Order does not matter given the CASCADE. */
export async function resetDatabase(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE ${decisionReasons}, ${decisions}, ${loanApplications}, ${businesses} RESTART IDENTITY CASCADE`,
  );
}

/**
 * Generates a syntactically valid, unique PAN so tests never collide on the
 * unique constraint.
 *
 * Shape is AAAAA9999A with 'P' in the 4th position (individual) and a surname
 * initial in the 5th, which keeps the PAN/name consistency factor predictable.
 */
let panCounter = 0;
export function uniquePan(surnameInitial = 'S'): string {
  panCounter = (panCounter + 1) % 10_000;
  const digits = String(panCounter).padStart(4, '0');
  //     ABC       P = individual   surname initial   4 digits   check letter
  return `ABC` + `P` + surnameInitial + digits + `F`;
}

/** A business payload that passes validation, overridable per test. */
export const validBusiness = (overrides: Record<string, unknown> = {}) => ({
  ownerName: 'Rajesh Sharma',
  pan: uniquePan('S'),
  businessType: 'SERVICES',
  monthlyRevenue: 800_000,
  ...overrides,
});

/** An application payload that passes validation, overridable per test. */
export const validApplication = (businessId: string, overrides: Record<string, unknown> = {}) => ({
  businessId,
  requestedAmount: 1_000_000,
  tenureMonths: 24,
  purpose: 'WORKING_CAPITAL',
  ...overrides,
});
