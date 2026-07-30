import { z } from 'zod';

/**
 * Environment configuration, validated once at boot.
 *
 * The process exits immediately if anything is missing or malformed. A service
 * that starts successfully and then fails on the first request because
 * DATABASE_URL was empty is far harder to diagnose than one that refuses to
 * start and says exactly which variable is wrong.
 */

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  MONGO_URL: z.string().min(1, 'MONGO_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  /**
   * Comma-separated allowlist of browser origins. Defaults to the Vite dev
   * server so a fresh clone works without configuration.
   */
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  /**
   * Artificial delay in the worker, so the 202-then-poll flow is actually
   * observable in the UI rather than completing before the first poll. Set to
   * 0 in production; it exists to make the async architecture demonstrable.
   */
  DECISION_PROCESSING_DELAY_MS: z.coerce.number().int().min(0).max(10_000).default(1_200),

  /**
   * How decisions get processed. All three modes keep the same public
   * contract — POST returns 202, the client polls until the status settles —
   * so switching between them never changes what a client sees.
   *
   *  - `queue`     Enqueue to BullMQ; a *separate* worker process consumes it.
   *                The right topology: API and worker scale independently and
   *                a slow evaluation cannot touch the API's event loop.
   *                Used by docker-compose.
   *
   *  - `embedded`  Enqueue to BullMQ and run the worker inside this process.
   *                Still a real queue with real retries and backoff, just
   *                co-located. Exists because Render's free plan does not
   *                offer background workers; it is also a reasonable topology
   *                for genuinely low volume.
   *
   *  - `inline`    No Redis at all — evaluate synchronously behind the same
   *                202-then-poll contract. Lets the API and the test suite run
   *                with only Postgres. Not for production.
   */
  DECISION_MODE: z.enum(['queue', 'embedded', 'inline']).default('queue'),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${issues}\n`);
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** Parsed CORS allowlist. Empty entries from a trailing comma are dropped. */
export const corsOrigins = env.CORS_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
