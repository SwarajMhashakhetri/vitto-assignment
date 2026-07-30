import cors from 'cors';
import express, { type Express } from 'express';
import { corsOrigins } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { requestId } from './middleware/request-id';
import { applicationRouter } from './modules/application/application.routes';
import { businessRouter } from './modules/business/business.routes';
import { healthRouter } from './modules/health/health.routes';

/**
 * Express application assembly.
 *
 * Kept separate from server.ts (which binds the port) so integration tests can
 * exercise the real app through supertest without opening a socket.
 *
 * Middleware order matters and is deliberate:
 *   requestId -> cors -> body parsing -> routes -> 404 -> error handler
 * The error handler is last, because Express only routes errors to handlers
 * registered after the middleware that threw.
 */
export function createApp(): Express {
  const app = express();

  // Render and Vercel sit behind a proxy; without this `req.ip` is the
  // proxy's address rather than the caller's.
  app.set('trust proxy', 1);
  // Nothing here needs to advertise the framework.
  app.disable('x-powered-by');

  app.use(requestId);

  app.use(
    cors({
      origin: corsOrigins,
      // Lets a browser client read the correlation id off the response.
      exposedHeaders: ['X-Request-Id'],
    }),
  );

  // 100kb is generous for the largest payload this API accepts and keeps a
  // malformed or hostile body from being parsed at all.
  app.use(express.json({ limit: '100kb' }));

  app.use('/', healthRouter);
  app.use('/api/v1/businesses', businessRouter);
  app.use('/api/v1/applications', applicationRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
