import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

// packages/db/src/migrate.ts -> repo root is three levels up.
loadEnv({ path: path.resolve(import.meta.dirname, '../../../.env') });

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is required to run migrations. Set it in the repo-root .env (see .env.example).',
    );
  }

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);
  const migrationsFolder = path.resolve(import.meta.dirname, '../migrations');

  console.log(`Applying migrations from ${migrationsFolder} to ${connectionString.replace(/:[^:@]*@/, ':***@')}`);
  await migrate(db, { migrationsFolder });
  console.log('Migrations complete.');

  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exitCode = 1;
});
