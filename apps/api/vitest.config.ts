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
    // Integration tests share one Postgres database, so files must not run
    // concurrently against each other. Engine tests are pure and unaffected.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
