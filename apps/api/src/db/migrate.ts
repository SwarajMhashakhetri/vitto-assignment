import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { env } from '../config/env';
import { logger } from '../lib/logger';

/**
 * Applies committed SQL migrations from ./drizzle.
 *
 * Run as a standalone step before the API starts, rather than on first
 * request: two API instances booting at once would otherwise race to create
 * the same tables. Drizzle records applied migrations in a tracking table, so
 * running this repeatedly is safe.
 */
async function main(): Promise<void> {
  // A dedicated single-connection pool: this process does nothing else, and it
  // must not hold open connections the API will need.
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  const db = drizzle(pool);

  // Resolved relative to this file so it works from both src/ (tsx) and dist/.
  const migrationsFolder = path.resolve(__dirname, '../../drizzle');

  logger.info('Applying database migrations', { migrationsFolder });

  try {
    await migrate(db, { migrationsFolder });
    logger.info('Migrations applied successfully');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  logger.error('Migration failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  // Non-zero exit so a deploy halts here rather than starting an API against
  // a schema that does not match the code.
  process.exit(1);
});
