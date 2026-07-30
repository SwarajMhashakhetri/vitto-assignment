import { eq } from 'drizzle-orm';
import type { ApplicationResource, CreateApplicationInput, LoanPurpose } from '@lds/shared';
import { db } from '../../db/client';
import { businesses, loanApplications, type LoanApplicationRow } from '../../db/schema';
import { NotFoundError } from '../../lib/errors';
import { numberToNumeric, numericToNumber, toIsoString } from '../../lib/serialize';

export function toApplicationResource(application: LoanApplicationRow): ApplicationResource {
  return {
    id: application.id,
    businessId: application.businessId,
    requestedAmount: numericToNumber(application.requestedAmount),
    tenureMonths: application.tenureMonths,
    purpose: application.purpose as LoanPurpose,
    status: application.status,
    createdAt: toIsoString(application.createdAt),
  };
}

/**
 * Creating an application does not evaluate it. The decision is triggered
 * explicitly via POST /applications/:id/decision, which keeps the three
 * resources independent and makes the async boundary visible in the API rather
 * than hidden inside a create.
 */
export async function createApplication(
  input: CreateApplicationInput,
): Promise<ApplicationResource> {
  // Checked explicitly so a bad businessId is a clear 404 rather than a
  // foreign-key violation translated into something vaguer.
  const [business] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(eq(businesses.id, input.businessId))
    .limit(1);

  if (!business) {
    throw new NotFoundError('Business', input.businessId);
  }

  const [application] = await db
    .insert(loanApplications)
    .values({
      businessId: input.businessId,
      requestedAmount: numberToNumeric(input.requestedAmount),
      tenureMonths: input.tenureMonths,
      purpose: input.purpose,
      status: 'QUEUED',
    })
    .returning();

  return toApplicationResource(application!);
}

export async function getApplicationById(id: string): Promise<ApplicationResource> {
  const [application] = await db
    .select()
    .from(loanApplications)
    .where(eq(loanApplications.id, id))
    .limit(1);

  if (!application) {
    throw new NotFoundError('Application', id);
  }

  return toApplicationResource(application);
}

/**
 * Loads everything the engine needs for one application in a single query.
 * Used by the decision worker.
 */
export async function getApplicationWithBusiness(id: string) {
  const application = await db.query.loanApplications.findFirst({
    where: eq(loanApplications.id, id),
    with: { business: true },
  });

  if (!application) {
    throw new NotFoundError('Application', id);
  }

  return application;
}
