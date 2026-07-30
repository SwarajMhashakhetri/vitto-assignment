import { Worker, type Job } from 'bullmq';
import { connectMongo } from '../db/mongo';
import { logger } from '../lib/logger';
import { markDecisionFailed, processDecision } from '../modules/decision/decision.service';
import { DECISION_QUEUE_NAME, createRedisConnection, type DecisionJobData } from './queue';

/**
 * The decision worker.
 *
 * Runs as its own process (see worker-entry.ts) so that a slow or wedged
 * evaluation cannot consume the API's event loop, and so the two can be scaled
 * independently — in production the API scales with traffic and the worker
 * scales with decision volume, which are not the same curve.
 */

export function createDecisionWorker(): Worker<DecisionJobData> {
  const worker = new Worker<DecisionJobData>(
    DECISION_QUEUE_NAME,
    async (job: Job<DecisionJobData>) => {
      const { applicationId, requestId } = job.data;

      logger.info('Processing decision job', {
        jobId: job.id,
        applicationId,
        requestId,
        attempt: job.attemptsMade + 1,
      });

      return processDecision({ applicationId, requestId });
    },
    {
      connection: createRedisConnection(),
      // Modest concurrency: each job holds a Postgres connection for the
      // duration of its transaction, so this is bounded by the pool, not CPU.
      concurrency: 5,
    },
  );

  worker.on('completed', (job) => {
    logger.info('Decision job completed', { jobId: job.id, applicationId: job.data.applicationId });
  });

  /**
   * Only mark the application FAILED once BullMQ has exhausted every attempt.
   * Failing it on the first error would show a user a permanent rejection for
   * what is about to be retried successfully a second later.
   */
  worker.on('failed', (job, error) => {
    if (!job) {
      logger.error('Decision job failed with no job context', { error: error.message });
      return;
    }

    const attemptsExhausted = job.attemptsMade >= (job.opts.attempts ?? 1);

    logger.warn('Decision job attempt failed', {
      jobId: job.id,
      applicationId: job.data.applicationId,
      attempt: job.attemptsMade,
      attemptsExhausted,
      error: error.message,
    });

    if (attemptsExhausted) {
      void markDecisionFailed(job.data.applicationId, job.data.requestId, error.message);
    }
  });

  worker.on('error', (error) => {
    logger.error('Decision worker error', { error: error.message });
  });

  return worker;
}

/** Boots the worker process and wires graceful shutdown. */
export async function startWorker(): Promise<void> {
  // Audit writes are best-effort, so a Mongo outage must not stop the worker
  // from starting and issuing decisions.
  await connectMongo().catch((error: unknown) => {
    logger.error('Worker could not connect to MongoDB; audit writes will be dropped', {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  const worker = createDecisionWorker();
  logger.info('Decision worker started', { queue: DECISION_QUEUE_NAME });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, draining decision worker`);
    // Lets in-flight jobs finish rather than orphaning applications in
    // PROCESSING, from which nothing would ever move them.
    await worker.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
