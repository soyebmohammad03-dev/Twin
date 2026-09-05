import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// packages/db/drizzle.config.ts -> repo root is two levels up.
// Uses fileURLToPath(import.meta.url) rather than import.meta.dirname —
// drizzle-kit loads this config through its own esbuild-based loader,
// which does not reliably populate import.meta.dirname.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(currentDir, '../../.env') });

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://twin:twin_dev_password@localhost:5432/twin_dev',
  },
});
