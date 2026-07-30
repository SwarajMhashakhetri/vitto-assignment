import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env, isProduction } from '../config/env';
import * as schema from './schema';

/**
 * Postgres client — the system of record.
 *
 * One shared pool per process. The global cache keeps `tsx watch` from leaking
 * a new pool on every hot reload in development.
 */

const globalForDb = globalThis as unknown as { pool?: Pool };

export const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    // Kept modest so the API and worker together stay well inside the
    // connection limit of a small managed Postgres instance.
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

if (!isProduction) {
  globalForDb.pool = pool;
}

export const db = drizzle(pool, { schema });

export type Database = typeof db;
/** The transaction handle, so services can accept either. */
export type DbExecutor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export async function disconnectDb(): Promise<void> {
  await pool.end();
}

/** Health check probe. Cheapest query that proves the pool is alive. */
export async function pingPostgres(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
