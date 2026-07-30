import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      /**
       * Resolve the shared package to its TypeScript source rather than its
       * build output.
       *
       * The shared package emits CommonJS because the Express API consumes it
       * that way, and Rollup cannot reliably pick named exports out of a CJS
       * module. Pointing at source sidesteps that, and has the side benefit
       * that the client bundle tree-shakes the schemas it does not use and
       * never runs against a stale dist/.
       */
      '@lds/shared': path.resolve(here, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
  },
});
