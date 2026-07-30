import { Router } from 'express';
import { isMongoConnected } from '../../db/mongo';
import { pingPostgres } from '../../db/client';
import { pingRedis } from '../../queue/queue';
import { asyncHandler } from '../../middleware/error-handler';
import { ENGINE_VERSION } from '../../config/scoring';

/**
 * Health checks.
 *
 * Two endpoints, because platforms need different answers to different
 * questions:
 *
 *  - `/healthz`  liveness. Is the process up? Never touches a dependency, so a
 *                database blip cannot get the container killed and restarted
 *                into the same blip.
 *  - `/readyz`   readiness. Can this instance serve traffic right now? Checks
 *                every dependency and returns 503 if any is down.
 */
export const healthRouter = Router();

healthRouter.get('/healthz', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    engineVersion: ENGINE_VERSION,
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

healthRouter.get(
  '/readyz',
  asyncHandler(async (_req, res) => {
    const [postgres, redis] = await Promise.all([pingPostgres(), pingRedis()]);
    const mongo = isMongoConnected();

    // Mongo carries only the best-effort audit trail, so its absence degrades
    // the service rather than making it unable to serve.
    const ready = postgres && redis;

    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      dependencies: { postgres, redis, mongo },
    });
  }),
);
