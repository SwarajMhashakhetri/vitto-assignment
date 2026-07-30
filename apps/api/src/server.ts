import { createApp } from './app';
import { env } from './config/env';
import { connectMongo, disconnectMongo } from './db/mongo';
import { disconnectDb } from './db/client';
import { logger } from './lib/logger';
import { closeDecisionQueue } from './queue/queue';
import { createDecisionWorker } from './queue/worker';

/**
 * API entrypoint. Binds the port and owns process lifecycle; the app itself is
 * built in app.ts so tests can use it without a socket.
 */

async function main(): Promise<void> {
  // Best-effort: the audit trail must not be able to stop the API booting.
  await connectMongo().catch((error: unknown) => {
    logger.error('Could not connect to MongoDB; audit writes will be dropped', {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  /**
   * In `embedded` mode the API also hosts the decision worker. Render's free
   * plan has no background worker service, so the alternative would be
   * dropping the queue entirely — this keeps the real BullMQ path, with its
   * retries and backoff, at the cost of sharing an event loop.
   */
  const embeddedWorker = env.DECISION_MODE === 'embedded' ? createDecisionWorker() : null;
  if (embeddedWorker) {
    logger.info('Decision worker running inside the API process');
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info('API listening', {
      port: env.PORT,
      env: env.NODE_ENV,
      decisionMode: env.DECISION_MODE,
    });
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down`);

    // Stop accepting new connections, then let in-flight requests finish
    // before tearing down the connections they depend on.
    server.close(() => {
      void (async () => {
        // Close the worker first so in-flight jobs drain rather than leaving
        // applications stuck in PROCESSING with nothing to move them on.
        if (embeddedWorker) await embeddedWorker.close();
        await Promise.allSettled([closeDecisionQueue(), disconnectDb(), disconnectMongo()]);
        process.exit(0);
      })();
    });

    // Backstop: never hang a deploy on a stuck connection.
    setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

/**
 * A rejected promise that reaches here means an `await` was missed somewhere.
 * Logged loudly rather than silently ignored, which is Node's default.
 */
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception, exiting', { error: error.message, stack: error.stack });
  // The process is in an undefined state; the supervisor should restart it.
  process.exit(1);
});

void main();
