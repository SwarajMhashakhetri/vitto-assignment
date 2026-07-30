import { eq } from 'drizzle-orm';
import type { BusinessResource, CreateBusinessInput } from '@lds/shared';
import { db } from '../../db/client';
import { businesses, type BusinessRow } from '../../db/schema';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { numberToNumeric, numericToNumber, toIsoString } from '../../lib/serialize';

/**
 * Business profile operations.
 *
 * The service owns all database access and all domain rules; the controller
 * above it only translates HTTP. That split is what lets the decision worker
 * reuse these functions without an HTTP layer in front of them.
 */

export function toBusinessResource(business: BusinessRow): BusinessResource {
  return {
    id: business.id,
    ownerName: business.ownerName,
    pan: business.pan,
    businessType: business.businessType,
    monthlyRevenue: numericToNumber(business.monthlyRevenue),
    createdAt: toIsoString(business.createdAt),
  };
}

async function findByPan(pan: string): Promise<BusinessRow | undefined> {
  const [row] = await db.select().from(businesses).where(eq(businesses.pan, pan)).limit(1);
  return row;
}

async function findById(id: string): Promise<BusinessRow | undefined> {
  const [row] = await db.select().from(businesses).where(eq(businesses.id, id)).limit(1);
  return row;
}

/**
 * PAN is the borrower's identity, so a second profile under the same PAN is a
 * conflict rather than a new record. The existing id is returned with the
 * error, letting a client update that profile instead of starting over — the
 * common case being a repeat borrower whose revenue has since changed.
 */
export async function createBusiness(input: CreateBusinessInput): Promise<BusinessResource> {
  const existing = await findByPan(input.pan);

  if (existing) {
    throw new ConflictError(`A business profile already exists for PAN ${input.pan}`, {
      businessId: existing.id,
    });
  }

  const [business] = await db
    .insert(businesses)
    .values({
      ownerName: input.ownerName,
      pan: input.pan,
      businessType: input.businessType,
      monthlyRevenue: numberToNumeric(input.monthlyRevenue),
    })
    .returning();

  return toBusinessResource(business!);
}

export async function getBusinessById(id: string): Promise<BusinessResource> {
  const business = await findById(id);

  if (!business) {
    throw new NotFoundError('Business', id);
  }

  return toBusinessResource(business);
}

/**
 * Full replacement of a profile. Used by the client after a 409, so a
 * returning applicant's current revenue is what gets scored rather than a
 * stale figure from a previous application.
 */
export async function updateBusiness(
  id: string,
  input: CreateBusinessInput,
): Promise<BusinessResource> {
  const existing = await findById(id);
  if (!existing) {
    throw new NotFoundError('Business', id);
  }

  // Moving a profile onto a PAN that belongs to a different business would
  // merge two borrowers into a single record.
  if (input.pan !== existing.pan) {
    const panOwner = await findByPan(input.pan);
    if (panOwner && panOwner.id !== id) {
      throw new ConflictError(`PAN ${input.pan} belongs to another business profile`, {
        businessId: panOwner.id,
      });
    }
  }

  const [business] = await db
    .update(businesses)
    .set({
      ownerName: input.ownerName,
      pan: input.pan,
      businessType: input.businessType,
      monthlyRevenue: numberToNumeric(input.monthlyRevenue),
      updatedAt: new Date(),
    })
    .where(eq(businesses.id, id))
    .returning();

  return toBusinessResource(business!);
}
