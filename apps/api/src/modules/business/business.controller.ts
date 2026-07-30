import type { Request, Response } from 'express';
import type { CreateBusinessInput } from '@lds/shared';
import { recordAuditEvent, redactPan } from '../../lib/audit';
import { created, ok } from '../../lib/respond';
import * as businessService from './business.service';

/**
 * HTTP translation only. No database access, no domain rules — those live in
 * the service, so the worker can reuse them without going through Express.
 */

export async function create(req: Request, res: Response): Promise<void> {
  const input = req.body as CreateBusinessInput;
  const business = await businessService.createBusiness(input);

  recordAuditEvent({
    requestId: req.requestId,
    eventType: 'BUSINESS_CREATED',
    businessId: business.id,
    payload: {
      ownerName: input.ownerName,
      // Never log a full national identifier; the last four digits are enough
      // to tie a record back to an applicant during an investigation.
      pan: redactPan(input.pan),
      businessType: input.businessType,
      monthlyRevenue: input.monthlyRevenue,
    },
    actor: { ip: req.ip, userAgent: req.header('user-agent') },
  });

  created(req, res, business);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const business = await businessService.getBusinessById(req.params.id as string);
  ok(req, res, business);
}

export async function update(req: Request, res: Response): Promise<void> {
  const business = await businessService.updateBusiness(
    req.params.id as string,
    req.body as CreateBusinessInput,
  );
  ok(req, res, business);
}
