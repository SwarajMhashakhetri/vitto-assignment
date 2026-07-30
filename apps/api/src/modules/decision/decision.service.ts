import { eq } from 'drizzle-orm';
import type {
  BusinessType,
  DecisionReason,
  DecisionResource,
  DecisionStatusResource,
  LoanPurpose,
} from '@lds/shared';
import { env } from '../../config/env';
import { db } from '../../db/client';
import {
  decisionReasons,
  decisions,
  loanApplications,
  type DecisionReasonRow,
  type DecisionRow,
} from '../../db/schema';
import { evaluate } from '../../engine';
import type { EvaluationInput } from '../../engine';
import { recordAuditEvent } from '../../lib/audit';
import { NotFoundError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { numberToNumeric, numericToNumber, toIsoString } from '../../lib/serialize';
import { enqueueDecisionJob } from '../../queue/queue';
import { getApplicationWithBusiness } from '../application/application.service';

type DecisionWithReasons = DecisionRow & { reasons: DecisionReasonRow[] };

function toDecisionResource(decision: DecisionWithReasons): DecisionResource {
  return {
    id: decision.id,
    applicationId: decision.applicationId,
    outcome: decision.outcome,
    creditScore: decision.creditScore,
    estimatedEmi: numericToNumber(decision.estimatedEmi),
    reasons: decision.reasons.map(
      (row): DecisionReason => ({
        code: row.code as DecisionReason['code'],
        severity: row.severity,
        message: row.message,
        pointsImpact: row.pointsImpact,
      }),
    ),
    engineVersion: decision.engineVersion,
    evaluatedAt: toIsoString(decision.evaluatedAt),
  };
}

/** Loads an application together with its decision and that decision's reasons. */
async function findApplicationWithDecision(applicationId: string) {
  return db.query.loanApplications.findFirst({
    where: eq(loanApplications.id, applicationId),
    with: { decision: { with: { reasons: true } } },
  });
}

/* -------------------------------------------------------------------------- */
/* Requesting a decision                                                      */
/* -------------------------------------------------------------------------- */

export interface RequestDecisionResult {
  status: DecisionStatusResource;
  /** False when an existing decision was returned rather than a new job queued. */
  enqueued: boolean;
}

/**
 * Triggers evaluation of an application.
 *
 * Idempotent by design: re-posting to an application that has already been
 * decided returns the stored decision rather than re-running the engine. A
 * client that retries after a dropped connection must not be able to produce a
 * second, possibly different, decision on the same application.
 */
export async function requestDecision(
  applicationId: string,
  requestId: string,
): Promise<RequestDecisionResult> {
  const application = await findApplicationWithDecision(applicationId);

  if (!application) {
    throw new NotFoundError('Application', applicationId);
  }

  if (application.decision) {
    return {
      enqueued: false,
      status: {
        applicationId,
        status: 'DECIDED',
        decision: toDecisionResource(application.decision),
        failureReason: null,
      },
    };
  }

  // A previously failed application is allowed back into the queue: the
  // failure was ours (a dependency was down), not the applicant's.
  await db
    .update(loanApplications)
    .set({ status: 'QUEUED', failureReason: null, updatedAt: new Date() })
    .where(eq(loanApplications.id, applicationId));

  recordAuditEvent({
    requestId,
    eventType: 'DECISION_REQUESTED',
    applicationId,
    businessId: application.businessId,
  });

  if (env.DECISION_MODE === 'inline') {
    // The same service function the worker calls — the only difference is
    // which process runs it. See config/env.ts for why this mode exists.
    await processDecision({ applicationId, requestId });
  } else {
    await enqueueDecisionJob({ applicationId, requestId });
  }

  return {
    enqueued: true,
    status: await getDecisionStatus(applicationId),
  };
}

/* -------------------------------------------------------------------------- */
/* Polling                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One envelope for every state, so a polling client has a single shape to
 * handle rather than branching on status codes. `decision` is populated only
 * once `status` is DECIDED.
 */
export async function getDecisionStatus(applicationId: string): Promise<DecisionStatusResource> {
  const application = await findApplicationWithDecision(applicationId);

  if (!application) {
    throw new NotFoundError('Application', applicationId);
  }

  return {
    applicationId,
    status: application.status,
    decision: application.decision ? toDecisionResource(application.decision) : null,
    failureReason: application.failureReason,
  };
}

/* -------------------------------------------------------------------------- */
/* Processing — called by the worker, or inline in DECISION_MODE=inline       */
/* -------------------------------------------------------------------------- */

export interface ProcessDecisionInput {
  applicationId: string;
  requestId: string;
}

/**
 * Runs the engine for one application and persists the result.
 *
 * The write is a single transaction: an application must never be left marked
 * DECIDED with no decision row, or with a decision row missing its reasons.
 */
export async function processDecision(input: ProcessDecisionInput): Promise<DecisionResource> {
  const { applicationId, requestId } = input;

  const application = await getApplicationWithBusiness(applicationId);

  // If a retry lands after a previous attempt already succeeded, return that
  // decision rather than writing a second one.
  const existing = await db.query.decisions.findFirst({
    where: eq(decisions.applicationId, applicationId),
    with: { reasons: true },
  });
  if (existing) {
    return toDecisionResource(existing);
  }

  await db
    .update(loanApplications)
    .set({ status: 'PROCESSING', updatedAt: new Date() })
    .where(eq(loanApplications.id, applicationId));

  // Deliberate delay so the 202-then-poll flow is observable in the UI rather
  // than completing before the client's first poll. Zero in production.
  if (env.DECISION_PROCESSING_DELAY_MS > 0) {
    await sleep(env.DECISION_PROCESSING_DELAY_MS);
  }

  const evaluationInput: EvaluationInput = {
    ownerName: application.business.ownerName,
    pan: application.business.pan,
    businessType: application.business.businessType as BusinessType,
    monthlyRevenue: numericToNumber(application.business.monthlyRevenue),
    requestedAmount: numericToNumber(application.requestedAmount),
    tenureMonths: application.tenureMonths,
    purpose: application.purpose as LoanPurpose,
  };

  const result = evaluate(evaluationInput);

  const decision = await db.transaction(async (tx) => {
    const [createdDecision] = await tx
      .insert(decisions)
      .values({
        applicationId,
        outcome: result.outcome,
        creditScore: result.creditScore,
        estimatedEmi: numberToNumeric(result.metrics.estimatedEmi),
        engineVersion: result.engineVersion,
      })
      .returning();

    const reasons = await tx
      .insert(decisionReasons)
      .values(
        result.reasons.map((reason) => ({
          decisionId: createdDecision!.id,
          code: reason.code,
          severity: reason.severity,
          message: reason.message,
          pointsImpact: reason.pointsImpact,
        })),
      )
      .returning();

    await tx
      .update(loanApplications)
      .set({ status: 'DECIDED', failureReason: null, updatedAt: new Date() })
      .where(eq(loanApplications.id, applicationId));

    return { ...createdDecision!, reasons };
  });

  logger.info('Decision completed', {
    requestId,
    applicationId,
    outcome: result.outcome,
    creditScore: result.creditScore,
  });

  // The full scoring trace goes to Mongo, not Postgres: it is a
  // variable-shaped diagnostic record, written once and never joined.
  recordAuditEvent({
    requestId,
    eventType: 'DECISION_COMPLETED',
    applicationId,
    businessId: application.businessId,
    payload: {
      outcome: result.outcome,
      creditScore: result.creditScore,
      metrics: result.metrics,
      reasonCodes: result.reasons.map((r) => r.code),
      engineVersion: result.engineVersion,
    },
    scoreTrace: result.scoreBreakdown,
  });

  return toDecisionResource(decision);
}

/**
 * Terminal failure path. Called by the worker only after BullMQ has exhausted
 * its retries, so a polling client is told the job died instead of waiting
 * forever on a status that will never change.
 */
export async function markDecisionFailed(
  applicationId: string,
  requestId: string,
  failureReason: string,
): Promise<void> {
  await db
    .update(loanApplications)
    .set({ status: 'FAILED', failureReason, updatedAt: new Date() })
    .where(eq(loanApplications.id, applicationId));

  recordAuditEvent({
    requestId,
    eventType: 'DECISION_FAILED',
    applicationId,
    payload: { failureReason },
  });

  logger.error('Decision processing failed permanently', {
    requestId,
    applicationId,
    failureReason,
  });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
