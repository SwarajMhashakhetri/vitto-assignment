import type { Request, Response } from 'express';
import type { ApiSuccess } from '@lds/shared';

/**
 * Success responses. Every payload is wrapped in `{ data, meta }` so a client
 * never has to guess whether it received a resource or an error, and so
 * pagination or rate-limit metadata can be added later without changing the
 * shape of any existing response.
 */
export function respond<T>(req: Request, res: Response, statusCode: number, data: T): void {
  const body: ApiSuccess<T> = {
    data,
    meta: { requestId: req.requestId },
  };
  res.status(statusCode).json(body);
}

export const ok = <T>(req: Request, res: Response, data: T) => respond(req, res, 200, data);
export const created = <T>(req: Request, res: Response, data: T) => respond(req, res, 201, data);
export const accepted = <T>(req: Request, res: Response, data: T) => respond(req, res, 202, data);
