import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Point at the shared package's source rather than its build output, so
      // tests never run against a stale dist/.
      '@lds/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    /**
     * Integration tests truncate and repopulate one shared Postgres database,
     * so test *files* must not run concurrently. Engine tests are pure and
     * unaffected by this.
     */
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      NODE_ENV: 'test',
      // Matches docker-compose. Override by exporting these before `npm test`.
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? 'postgresql://lds:lds_password@localhost:5433/lending',
      MONGO_URL: process.env.TEST_MONGO_URL ?? 'mongodb://localhost:27017/lending_audit_test',
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379',
      /**
       * Inline rather than queued: the test suite exercises the same service
       * function the worker calls, behind the same 202-then-poll contract, but
       * without needing Redis or a second process. The queue path itself is
       * verified by running the stack under docker-compose.
       */
      DECISION_MODE: 'inline',
      /**
       * Deliberately messy: a stray space and a trailing slash, because that
       * is what a value pasted into a deployment dashboard actually looks
       * like. The allowlist tests assert both are tolerated.
       */
      CORS_ORIGIN: 'http://localhost:5173, https://lending-demo.vercel.app/',
      // No artificial delay in tests; it exists only to make the UI's polling
      // visible during a demo.
      DECISION_PROCESSING_DELAY_MS: '0',
    },
  },
});
