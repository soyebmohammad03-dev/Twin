import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

/**
 * The type of `tx` inside `db.transaction(async (tx) => ...)`. Service
 * functions that need to run either standalone or as part of a larger
 * transaction (e.g. creating a memory + its source + its entity links
 * atomically) should accept `Database | Transaction` so the caller
 * decides whether they're composed into one.
 */
export type Transaction = Parameters<Database['transaction']>[0] extends (tx: infer T, ...args: never[]) => unknown
  ? T
  : never;

/** Either the real pooled client or an in-flight transaction — anything you can run a query against. */
export type Queryable = Database | Transaction;

/**
 * Creates a lazily-connecting Postgres pool + typed Drizzle client.
 * Constructing this does NOT verify connectivity — `pg.Pool` only
 * opens a connection on first query. Use the API's `/health/db` route
 * to actually verify the database is reachable.
 */
export function createDatabase(connectionString: string): { db: Database; pool: Pool } {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
