import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import type { ApiError } from '@lds/shared';
import { isProduction } from '../config/env';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import { logger } from '../lib/logger';
import { toFieldErrors } from './validate';

/**
 * The single place where an error becomes a response.
 *
 * Every route handler is wrapped so anything thrown — including from an async
 * function — arrives here. Nothing else in the codebase sets an error status
 * code or writes an error body, which is what makes the envelope genuinely
 * consistent rather than consistent by convention.
 */

/**
 * Wraps an async handler so a rejected promise reaches Express's error
 * pipeline. Without this, an async throw becomes an unhandled rejection and
 * the client hangs until it times out.
 */
export function asyncHandler<T extends (req: Request, res: Response, next: NextFunction) => unknown>(
  handler: T,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/** 404 for unmatched routes, so unknown paths use the same envelope. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`Route ${req.method} ${req.path}`));
}

/**
 * Postgres error codes worth translating into domain errors, so a database
 * constraint surfaces as a meaningful 409 or 422 rather than an opaque 500.
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_NUMERIC_OUT_OF_RANGE = '22003';

interface PostgresError {
  code: string;
  constraint?: string;
  detail?: string;
}

function isPostgresError(error: unknown): error is PostgresError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  );
}

function translatePostgresError(error: PostgresError): AppError | null {
  switch (error.code) {
    case PG_UNIQUE_VIOLATION:
      return new ConflictError('A record with these details already exists');
    case PG_FOREIGN_KEY_VIOLATION:
      return new ValidationError(
        [{ field: 'businessId', message: 'Referenced record does not exist' }],
        'The request references a record that does not exist',
      );
    case PG_NUMERIC_OUT_OF_RANGE:
      return new ValidationError(
        [{ field: '(request)', message: 'A numeric value exceeds the supported range' }],
        'A numeric value is out of range',
      );
    default:
      return null;
  }
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  // Express identifies an error handler by its arity, so `next` must stay in
  // the signature even though it is unused.
  _next: NextFunction,
): void {
  const requestId = req.requestId ?? 'unknown';
  let appError: AppError;

  if (error instanceof AppError) {
    appError = error;
  } else if (error instanceof ZodError) {
    // A schema parsed outside the validate middleware, e.g. inside a service.
    appError = new ValidationError(toFieldErrors(error));
  } else if (error instanceof SyntaxError && 'body' in error) {
    // express.json() could not parse the payload.
    appError = new AppError(400, 'MALFORMED_JSON', 'Request body is not valid JSON');
  } else if (isPostgresError(error)) {
    appError = translatePostgresError(error) ?? unexpectedError();
  } else {
    appError = unexpectedError();
  }

  logError(appError, error, req, requestId);

  const body: ApiError = {
    error: {
      code: appError.code,
      message: appError.message,
      details: appError.details,
      requestId,
      ...(appError instanceof ConflictError && appError.conflictingResource
        ? { conflict: appError.conflictingResource }
        : {}),
    },
  };

  res.status(appError.statusCode).json(body);
}

function unexpectedError(): AppError {
  // Deliberately generic. Internal failure messages can carry table names,
  // query fragments or file paths, none of which belong in a client response.
  return new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}

function logError(appError: AppError, original: unknown, req: Request, requestId: string): void {
  const context = {
    requestId,
    method: req.method,
    path: req.originalUrl,
    statusCode: appError.statusCode,
    code: appError.code,
  };

  if (appError.statusCode >= 500) {
    logger.error(appError.message, {
      ...context,
      // The stack goes to the log, never to the response.
      stack: original instanceof Error ? original.stack : undefined,
      ...(isProduction ? {} : { original: String(original) }),
    });
    return;
  }

  logger.info(`Request rejected: ${appError.message}`, context);
}
