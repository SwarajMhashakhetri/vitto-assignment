import { z } from 'zod';

/**
 * Environment configuration, validated once at boot.
 *
 * The process exits immediately if anything is missing or malformed. A service
 * that starts successfully and then fails on the first request because
 * DATABASE_URL was empty is far harder to diagnose than one that refuses to
 * start and says exactly which variable is wrong.
 */

/**
 * Why an origin is unusable in an allowlist, or `null` if it is fine.
 *
 * A browser's `Origin` header is always scheme + host + optional port, and
 * nothing else. Anything that cannot take that shape can never match a real
 * request, so it is a configuration error rather than a stricter rule.
 */
export function describeInvalidOrigin(entry: string): string | null {
  let parsed: URL;

  try {
    parsed = new URL(entry);
  } catch {
    return `CORS_ORIGIN entry "${entry}" is not a URL — an origin needs a scheme, e.g. https://${entry}`;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    // Reached by a bare `host:port`, which URL happily parses with the host
    // as the protocol. The likeliest paste, and the least obvious failure.
    return `CORS_ORIGIN entry "${entry}" must start with http:// or https://`;
  }

  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    return `CORS_ORIGIN entry "${entry}" must be a bare origin — scheme, host and optional port, with no path`;
  }

  return null;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  MONGO_URL: z.string().min(1, 'MONGO_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  /**
   * Comma-separated allowlist of browser origins. Defaults to the Vite dev
   * server so a fresh clone works without configuration.
   *
   * Validated at boot rather than trusted, because an unmatchable entry is
   * invisible until a browser tries: the preflight still answers 204, just
   * without the grant header. Failing here costs one restart; failing lazily
   * costs an afternoon.
   */
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .superRefine((value, ctx) => {
      for (const entry of value.split(',').map((origin) => origin.trim())) {
        if (entry === '') continue;

        const problem = describeInvalidOrigin(entry);
        if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
      }
    }),

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

/**
 * Canonical form of an origin, for comparison only.
 *
 * A browser sends `scheme://host[:port]` with no path and no trailing slash,
 * but the value a human pastes into a dashboard is copied from an address bar
 * and usually carries one. An allowlist that rejects
 * `https://example.vercel.app/` while accepting `https://example.vercel.app`
 * is technically correct and practically a trap: the preflight still answers
 * 204, just without the grant header, so the browser reports a generic CORS
 * failure with nothing pointing at the extra character.
 */
export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

/** Parsed CORS allowlist. Empty entries from a trailing comma are dropped. */
export const corsOrigins = env.CORS_ORIGIN.split(',').map(normalizeOrigin).filter(Boolean);
