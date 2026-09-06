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

  // The pgvector extension has to exist before any migration touching
  // a `vector` column can run. Locally this happens once, automatically,
  // via infra/init/001-extensions.sql — but that script only ever runs
  // on a brand-new docker-compose volume. Any real production database
  // (a managed Postgres, a differently-orchestrated container, a
  // restored backup) never sees that init script, so `npm run
  // db:migrate` has to be able to do this itself. IF NOT EXISTS makes
  // this safe to run every time, including against a database that
  // already has the extension.
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector;');

  await migrate(db, { migrationsFolder });
  console.log('Migrations complete.');

  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exitCode = 1;
});
