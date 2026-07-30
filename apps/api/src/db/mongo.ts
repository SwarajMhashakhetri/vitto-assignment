import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import { env } from '../config/env';
import { logger } from '../lib/logger';

/**
 * MongoDB — the append-only audit stream.
 *
 * Why a second store at all: the audit log is write-heavy, its document shape
 * varies by event type (a validation failure and a decision record share
 * almost no fields), and it is only ever read back by application id or time
 * range — never joined against anything. That is a document store's shape, not
 * a relational one, and keeping it out of Postgres keeps the transactional
 * tables narrow.
 *
 * The honest caveat, also stated in the write-up: at this volume a JSONB
 * column in Postgres would do the job with one less service to operate.
 */

const auditEventSchema = new Schema(
  {
    /** Correlates an audit row with the API response the caller saw. */
    requestId: { type: String, required: true, index: true },
    eventType: {
      type: String,
      required: true,
      enum: [
        'BUSINESS_CREATED',
        'APPLICATION_CREATED',
        'DECISION_REQUESTED',
        'DECISION_COMPLETED',
        'DECISION_FAILED',
        'VALIDATION_REJECTED',
      ],
      index: true,
    },
    applicationId: { type: String, default: null, index: true },
    businessId: { type: String, default: null },
    /** Raw request payload or engine output. Shape varies by eventType. */
    payload: { type: Schema.Types.Mixed, default: {} },
    /** Per-factor score breakdown, present on DECISION_COMPLETED only. */
    scoreTrace: { type: [Schema.Types.Mixed], default: [] },
    actor: {
      ip: { type: String, default: null },
      userAgent: { type: String, default: null },
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    // Audit rows are never edited, so there is no versioning to track.
    versionKey: false,
    collection: 'audit_events',
  },
);

export type AuditEvent = InferSchemaType<typeof auditEventSchema>;

/**
 * Reuse an already-registered model when one exists. Mongoose throws
 * `OverwriteModelError` if the same name is registered twice, which happens on
 * every hot reload under `tsx watch`.
 *
 * The explicit annotation is needed because `mongoose.models` is loosely typed
 * as a record of `Model<any>`, and the resulting union is not callable.
 */
export const AuditEventModel: Model<AuditEvent> =
  (mongoose.models.AuditEvent as Model<AuditEvent> | undefined) ??
  mongoose.model<AuditEvent>('AuditEvent', auditEventSchema);

let connectionPromise: Promise<typeof mongoose> | null = null;

/**
 * Connects lazily and only once. Callers do not await this on the request
 * path — see lib/audit.ts for why audit writes must not be able to fail a
 * request.
 */
export async function connectMongo(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(env.MONGO_URL, {
      serverSelectionTimeoutMS: 5_000,
    });
  }

  await connectionPromise;
  logger.info('Connected to MongoDB');
}

export async function disconnectMongo(): Promise<void> {
  connectionPromise = null;
  await mongoose.disconnect();
}

/** Health check probe. `readyState === 1` means connected. */
export function isMongoConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
