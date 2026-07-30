import type { Request, Response } from 'express';
import type { CreateApplicationInput } from '@lds/shared';
import { recordAuditEvent } from '../../lib/audit';
import { created, ok } from '../../lib/respond';
import * as applicationService from './application.service';

export async function create(req: Request, res: Response): Promise<void> {
  const input = req.body as CreateApplicationInput;
  const application = await applicationService.createApplication(input);

  recordAuditEvent({
    requestId: req.requestId,
    eventType: 'APPLICATION_CREATED',
    applicationId: application.id,
    businessId: application.businessId,
    payload: {
      requestedAmount: input.requestedAmount,
      tenureMonths: input.tenureMonths,
      purpose: input.purpose,
    },
    actor: { ip: req.ip, userAgent: req.header('user-agent') },
  });

  created(req, res, application);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const application = await applicationService.getApplicationById(req.params.id as string);
  ok(req, res, application);
}
