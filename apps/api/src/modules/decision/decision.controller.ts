import type { Request, Response } from 'express';
import { findAuditEventsForApplication } from '../../lib/audit';
import { accepted, ok } from '../../lib/respond';
import * as decisionService from './decision.service';

/**
 * POST /applications/:id/decision
 *
 * Returns 202 with a poll URL when a job was queued, and 200 with the stored
 * decision when the application had already been evaluated. The status code
 * itself tells the client whether it needs to poll.
 */
export async function requestDecision(req: Request, res: Response): Promise<void> {
  const applicationId = req.params.id as string;
  const { status, enqueued } = await decisionService.requestDecision(applicationId, req.requestId);

  const pollUrl = `/api/v1/applications/${applicationId}/decision`;

  if (!enqueued) {
    ok(req, res, { ...status, pollUrl });
    return;
  }

  accepted(req, res, { ...status, pollUrl });
}

/**
 * GET /applications/:id/decision
 *
 * The poll target. Always 200 with the same envelope; `status` carries the
 * state and `decision` is populated once it settles. A pending decision is not
 * an error, so it does not get an error status code.
 */
export async function getDecisionStatus(req: Request, res: Response): Promise<void> {
  const status = await decisionService.getDecisionStatus(req.params.id as string);
  ok(req, res, status);
}

/**
 * GET /applications/:id/audit
 *
 * Exposes the MongoDB audit trail for one application so the event stream is
 * inspectable without a database shell.
 */
export async function getAuditTrail(req: Request, res: Response): Promise<void> {
  const applicationId = req.params.id as string;
  const events = await findAuditEventsForApplication(applicationId);
  ok(req, res, { applicationId, events });
}
