import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit reads DATABASE_URL from the environment. Migrations are
 * generated into ./drizzle and committed, so a deploy applies reviewed SQL
 * rather than diffing against production at runtime.
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://lds:lds_password@localhost:5433/lending',
  },
  strict: true,
  verbose: true,
});
