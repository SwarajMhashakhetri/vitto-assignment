import { Router } from 'express';
import { createBusinessSchema, uuidParamSchema } from '@lds/shared';
import { asyncHandler } from '../../middleware/error-handler';
import { validate } from '../../middleware/validate';
import * as controller from './business.controller';

/**
 * /api/v1/businesses — the business and owner profile resource.
 */
export const businessRouter = Router();

businessRouter.post(
  '/',
  validate(createBusinessSchema),
  asyncHandler(controller.create),
);

businessRouter.get(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.getById),
);

// Full replacement rather than PATCH: the profile is four fields, and a
// partial update of a credit input is an invitation to score a half-updated
// record.
businessRouter.put(
  '/:id',
  validate(uuidParamSchema, 'params'),
  validate(createBusinessSchema),
  asyncHandler(controller.update),
);
