import cors from 'cors';
import express, { type Express } from 'express';
import { corsOrigins, normalizeOrigin } from './config/env';
import { logger } from './lib/logger';
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
      origin(requestOrigin, callback) {
        // Same-origin requests, curl, and the platform health check send no
        // Origin header at all. CORS is a browser policy; there is nothing to
        // grant or withhold here.
        if (!requestOrigin) {
          callback(null, true);
          return;
        }

        if (corsOrigins.includes(normalizeOrigin(requestOrigin))) {
          callback(null, true);
          return;
        }

        // A denied origin still gets a 204 preflight, just with no
        // Access-Control-Allow-Origin header — which the browser reports as a
        // generic CORS error that says nothing about why. Logging the origin
        // alongside the configured allowlist turns "CORS is broken" into a
        // one-line diff a deployer can act on.
        logger.warn('Blocked a cross-origin request from an origin outside CORS_ORIGIN', {
          origin: requestOrigin,
          allowed: corsOrigins,
        });
        callback(null, false);
      },
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
