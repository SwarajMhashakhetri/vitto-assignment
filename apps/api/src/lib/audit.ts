import { AuditEventModel } from '../db/mongo';
import { logger } from './logger';

/**
 * Audit trail writer.
 *
 * The governing rule here: **an audit write must never fail a request.**
 * A borrower should not be denied a decision because the log store is briefly
 * unreachable. So every write is fire-and-forget and swallows its own errors
 * into the application log.
 *
 * That is the right trade for this system, but it is a trade, and worth being
 * explicit about: it means the audit trail is best-effort rather than
 * guaranteed. A system under a regulatory retention obligation would invert
 * this — writing the audit record inside the same transaction as the decision,
 * and failing the request if it could not be persisted.
 */

export type AuditEventType =
  | 'BUSINESS_CREATED'
  | 'APPLICATION_CREATED'
  | 'DECISION_REQUESTED'
  | 'DECISION_COMPLETED'
  | 'DECISION_FAILED'
  | 'VALIDATION_REJECTED';

export interface AuditActor {
  ip?: string | null;
  userAgent?: string | null;
}

export interface RecordAuditEventInput {
  requestId: string;
  eventType: AuditEventType;
  applicationId?: string | null;
  businessId?: string | null;
  payload?: Record<string, unknown>;
  scoreTrace?: unknown[];
  actor?: AuditActor;
}

/**
 * Writes one audit event. Returns immediately; the caller is not expected to
 * await it, and no caller should branch on its result.
 */
export function recordAuditEvent(input: RecordAuditEventInput): void {
  void AuditEventModel.create({
    requestId: input.requestId,
    eventType: input.eventType,
    applicationId: input.applicationId ?? null,
    businessId: input.businessId ?? null,
    payload: input.payload ?? {},
    scoreTrace: input.scoreTrace ?? [],
    actor: {
      ip: input.actor?.ip ?? null,
      userAgent: input.actor?.userAgent ?? null,
    },
  }).catch((error: unknown) => {
    logger.error('Failed to write audit event', {
      requestId: input.requestId,
      eventType: input.eventType,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/**
 * Reads an application's audit history, newest first. Exposed through a debug
 * route so the trail is inspectable without a Mongo shell.
 */
export async function findAuditEventsForApplication(applicationId: string) {
  return AuditEventModel.find({ applicationId }).sort({ createdAt: -1 }).limit(100).lean();
}

/**
 * Strips fields that should not be persisted to the audit log verbatim.
 * PAN is a national identifier: the last four characters are enough to trace a
 * record back to an applicant during an investigation, and storing the rest in
 * a log adds exposure for no operational gain.
 */
export function redactPan(pan: string): string {
  if (pan.length <= 4) return '****';
  return `${'*'.repeat(pan.length - 4)}${pan.slice(-4)}`;
}
