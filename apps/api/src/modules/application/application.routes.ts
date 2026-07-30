import { Router } from 'express';
import { createApplicationSchema, uuidParamSchema } from '@lds/shared';
import { asyncHandler } from '../../middleware/error-handler';
import { validate } from '../../middleware/validate';
import * as decisionController from '../decision/decision.controller';
import * as controller from './application.controller';

/**
 * /api/v1/applications — the loan application resource.
 *
 * The decision routes are mounted here rather than under a top-level
 * /decisions collection because a decision has no independent existence: it is
 * always the decision *of* an application, and its identity is the
 * application's. Nesting keeps that relationship in the URL.
 */
export const applicationRouter = Router();

applicationRouter.post(
  '/',
  validate(createApplicationSchema),
  asyncHandler(controller.create),
);

applicationRouter.get(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.getById),
);

/** Enqueue an evaluation. Returns 202 immediately; idempotent once decided. */
applicationRouter.post(
  '/:id/decision',
  validate(uuidParamSchema, 'params'),
  asyncHandler(decisionController.requestDecision),
);

/** Poll target. Returns the same envelope in every status. */
applicationRouter.get(
  '/:id/decision',
  validate(uuidParamSchema, 'params'),
  asyncHandler(decisionController.getDecisionStatus),
);

/** Audit history for one application, newest first. */
applicationRouter.get(
  '/:id/audit',
  validate(uuidParamSchema, 'params'),
  asyncHandler(decisionController.getAuditTrail),
);
