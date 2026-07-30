import { logger } from './lib/logger';
import { startWorker } from './queue/worker';

/**
 * Worker entrypoint. Deployed as a separate service from the API so a slow
 * evaluation cannot block request handling, and so the two scale independently.
 */

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection in worker', { reason: String(reason) });
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception in worker, exiting', { error: error.message, stack: error.stack });
  process.exit(1);
});

void startWorker();
