import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, ZodError } from 'zod';
import type { ApiFieldError } from '@lds/shared';
import { ValidationError } from '../lib/errors';

/**
 * Schema validation middleware.
 *
 * Two properties matter here:
 *
 *  1. **Every** failing field is reported, not just the first. Returning one
 *     error at a time forces the user through a fix-resubmit-discover loop,
 *     which is a bad experience on a form this size.
 *  2. The parsed, coerced result *replaces* the raw input. Handlers downstream
 *     receive typed, trimmed, upper-cased values and never re-parse — there is
 *     exactly one place where untrusted input becomes trusted.
 */

type RequestPart = 'body' | 'params' | 'query';

/** Flattens a ZodError into the flat field/message pairs the envelope uses. */
export function toFieldErrors(error: ZodError): ApiFieldError[] {
  return error.issues.map((issue) => ({
    // A top-level failure has an empty path; label it for the caller.
    field: issue.path.length > 0 ? issue.path.join('.') : '(request)',
    message: issue.message,
  }));
}

export function validate(schema: ZodTypeAny, part: RequestPart = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[part]);

    if (!result.success) {
      next(new ValidationError(toFieldErrors(result.error)));
      return;
    }

    // `req.query` is a getter on Express 5; assigning to a copy keeps this
    // working across both major versions.
    if (part === 'query') {
      Object.defineProperty(req, 'query', { value: result.data, writable: true });
    } else {
      req[part] = result.data;
    }

    next();
  };
}
