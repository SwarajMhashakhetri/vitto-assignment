import type { ApiFieldError } from '@lds/shared';

/**
 * Application error hierarchy.
 *
 * Route handlers throw these; the central error handler is the only place that
 * turns them into a response. That keeps status codes and the error envelope
 * out of business logic, and means no handler can invent its own error shape.
 *
 * Anything thrown that is *not* an AppError is treated as an unexpected fault:
 * logged with its stack, reported as a generic 500, and never leaked to the
 * client.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: ApiFieldError[];
  /** Expected errors are logged at info; unexpected ones at error with a stack. */
  readonly isOperational = true;

  constructor(statusCode: number, code: string, message: string, details: ApiFieldError[] = []) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

/** 422 — the request was well-formed JSON but failed schema validation. */
export class ValidationError extends AppError {
  constructor(details: ApiFieldError[], message = 'The request contains invalid fields') {
    super(422, 'VALIDATION_ERROR', message, details);
  }
}

/** 400 — the request could not be parsed at all. */
export class BadRequestError extends AppError {
  constructor(message = 'Malformed request') {
    super(400, 'BAD_REQUEST', message);
  }
}

/** 404 — the addressed resource does not exist. */
export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      404,
      'NOT_FOUND',
      id ? `${resource} '${id}' was not found` : `${resource} was not found`,
    );
  }
}

/**
 * 409 — the request is valid but conflicts with current state. Carries an
 * optional payload so the client can act on it, e.g. the id of the existing
 * business behind a duplicate PAN.
 */
export class ConflictError extends AppError {
  readonly conflictingResource?: Record<string, unknown>;

  constructor(message: string, conflictingResource?: Record<string, unknown>) {
    super(409, 'CONFLICT', message);
    this.conflictingResource = conflictingResource;
  }
}

/** 503 — a dependency (database, queue) is unreachable. */
export class ServiceUnavailableError extends AppError {
  constructor(dependency: string) {
    super(503, 'SERVICE_UNAVAILABLE', `${dependency} is currently unavailable`);
  }
}
