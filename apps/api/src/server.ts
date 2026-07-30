import { createApp } from './app';
import { env } from './config/env';
import { connectMongo, disconnectMongo } from './db/mongo';
import { disconnectDb } from './db/client';
import { logger } from './lib/logger';
import { closeDecisionQueue } from './queue/queue';

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
