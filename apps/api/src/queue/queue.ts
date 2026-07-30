import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../lib/logger';

/**
 * The decision queue.
 *
 * Credit evaluation is fast today, but treating it as a background job is the
 * right shape for what it becomes: a real engine calls a bureau, pulls GST
 * filings and parses bank statements, any of which can take seconds or fail
 * and need retrying. Building the async boundary in now means those can be
 * added without changing the API contract a client depends on.
 */

export const DECISION_QUEUE_NAME = 'decision-evaluation';

export interface DecisionJobData {
  applicationId: string;
  /** Carried through so worker log lines correlate with the originating API call. */
  requestId: string;
}

/**
 * BullMQ requires `maxRetriesPerRequest: null` — it manages its own retry
 * semantics and ioredis's per-command retries interfere with blocking reads.
 */
export const createRedisConnection = (): IORedis =>
  new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

let queueInstance: Queue<DecisionJobData> | null = null;

export function getDecisionQueue(): Queue<DecisionJobData> {
  if (!queueInstance) {
    queueInstance = new Queue<DecisionJobData>(DECISION_QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        // Three attempts with exponential backoff. A transient database blip
        // should not turn into a failed application.
        attempts: 3,
        backoff: { type: 'exponential', delay: 1_000 },
        // Keep a short history for debugging without letting Redis grow
        // unbounded; Postgres and Mongo are the durable records.
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    });

    queueInstance.on('error', (error) => {
      logger.error('Decision queue error', { error: error.message });
    });
  }

  return queueInstance;
}

export async function enqueueDecisionJob(data: DecisionJobData): Promise<void> {
  const queue = getDecisionQueue();
  await queue.add('evaluate', data, {
    // The application id doubles as the job id, so a double-submit collapses
    // into one job instead of evaluating the same application twice.
    jobId: data.applicationId,
  });
}

export async function closeDecisionQueue(): Promise<void> {
  if (queueInstance) {
    await queueInstance.close();
    queueInstance = null;
  }
}

/** Health check probe. */
export async function pingRedis(): Promise<boolean> {
  if (env.DECISION_MODE === 'inline') return true;

  try {
    // BullMQ types `client` as a union of supported Redis clients, which hides
    // `ping`. Every member implements it, so the narrowing is safe.
    const client = (await getDecisionQueue().client) as unknown as {
      ping(): Promise<string>;
    };
    return (await client.ping()) === 'PONG';
  } catch {
    return false;
  }
}
