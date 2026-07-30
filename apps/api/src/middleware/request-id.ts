import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Assigns every request a correlation id.
 *
 * The id is echoed in the response envelope, returned on errors, and written
 * into the audit trail — so an error a user reports from the UI can be traced
 * to the exact stored record without asking them what time it happened.
 *
 * An inbound `X-Request-Id` is honoured when present so the id survives a
 * proxy or an upstream caller.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header('x-request-id');
  req.requestId = inbound && inbound.length <= 100 ? inbound : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}
