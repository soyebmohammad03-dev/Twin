import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

// apps/api/src/config/env.ts -> repo root is four levels up.
// Silently does nothing if the file doesn't exist (e.g. under Vitest,
// which injects its own env — see vitest.config.ts).
loadEnv({ path: path.resolve(import.meta.dirname, '../../../../.env') });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required.'),
    // Signs access tokens only. Refresh tokens are NOT JWTs — they're
    // opaque random bytes, stored only as a SHA-256 hash (see
    // modules/auth/tokens.ts) — so there is no separate refresh secret.
    JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters.'),
    CORS_ORIGIN: z.string().default('http://localhost:3000'),
    // Ingestion extraction provider. 'heuristic' (the default) does
    // real, non-AI, non-fake entity-mention linking against EXISTING
    // entities only — see modules/ingestion/extraction/heuristicProvider.ts.
    // It always runs, regardless of this setting, as the safe baseline
    // for the primary memory's entity links. 'gemini' additionally runs
    // the real AI extraction pipeline (modules/ingestion/ai,
    // modules/ingestion/extraction/pipeline.ts) on top of that baseline —
    // structured people/projects/goals/ideas/decisions/events/
    // preferences/facts/relationships extraction, with entity
    // resolution and epistemic provenance. Never silently falls back:
    // selecting 'gemini' without GEMINI_API_KEY set fails startup below.
    EXTRACTION_PROVIDER: z.enum(['heuristic', 'gemini']).default('heuristic'),
    // Required when EXTRACTION_PROVIDER=gemini. Server-side only — never
    // sent to or readable by the frontend.
    GEMINI_API_KEY: z.string().optional(),
    // Kept configurable (not hardcoded) so a future model swap is a
    // config change, not a code change.
    GEMINI_MODEL: z.string().default('gemini-3.6-flash'),
    // Wall-clock budget for one Gemini call before it's treated as a
    // provider failure (see ai/types.ts AIProviderError code 'timeout').
    // Generous by normal API standards — this specific dev environment
    // has been observed to add 30-40s of latency to outbound HTTPS
    // calls made from a process that also holds an open listening
    // socket (see docs/architecture.md's Phase 5 notes). A production
    // deployment moving this call off the request path entirely (a
    // background worker) would make this constant far less load-bearing.
    GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
    // Phase 6 embedding provider. 'none' (the default) means memory
    // embeddings are simply never generated — semantic search then has
    // nothing to search over, and retrieval.service.ts falls back to
    // lexical + entity-aware signals only. It never pretends an
    // embedding exists when one wasn't actually generated. 'gemini'
    // uses the same GEMINI_API_KEY as extraction (one Google AI Studio
    // key covers both generation and embedding); selecting it without
    // a key fails startup below, same fail-loud pattern as extraction.
    EMBEDDING_PROVIDER: z.enum(['none', 'gemini']).default('none'),
    // gemini-embedding-001's native output is 3072-d; requesting
    // outputDimensionality=1536 (verified live) keeps this compatible
    // with the existing memories.embedding vector(1536) column without
    // a schema migration. Not read from a separate "dimensions" env
    // var — the column type is the actual source of truth, so the
    // constant lives in code (packages/db/src/schema/memories.ts) and
    // this only names the model.
    EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
    EMBEDDING_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    // Phase 18 reasoning provider. 'none' (the default) means POST
    // /reason falls back to MockReasoningProvider — the same graceful-
    // degradation shape EMBEDDING_PROVIDER=none already has for
    // semantic search (never a hard failure, never a silently-fake
    // "real" answer; MockReasoningProvider's output is honestly
    // template-based and never claims otherwise). 'gemini' uses the
    // same GEMINI_API_KEY as extraction/embeddings; selecting it
    // without a key fails startup below, same fail-loud pattern.
    REASONING_PROVIDER: z.enum(['none', 'gemini']).default('none'),
    // Deliberately its own config knob (not reused from GEMINI_MODEL),
    // matching EMBEDDING_MODEL's precedent — reasoning may reasonably
    // want a different model than extraction someday without a code
    // change here.
    REASONING_MODEL: z.string().default('gemini-3.6-flash'),
    REASONING_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    // Phase 47 — how often the background worker's scheduler cycle
    // runs. Deliberately a plain setInterval loop, not a cron
    // library: this project has no other job infrastructure, and a
    // periodic scan with a DB-level idempotency constraint (see
    // notifications.dedupeKey) is the smallest correct mechanism for
    // "check every N minutes whether any user's local time now falls
    // in a delivery window."
    WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
    // Phase 47 Web Push. All three optional together: unset means push
    // delivery is honestly disabled (worker still generates and
    // persists notifications; only the push-send attempt is skipped)
    // rather than silently failing or faking success. VAPID keys are
    // self-generated (see `npx web-push generate-vapid-keys`), not a
    // third-party account/credential — safe to create fresh per
    // deployment. VAPID_PRIVATE_KEY never leaves this process.
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().optional(),
  })
  .refine((data) => data.EXTRACTION_PROVIDER !== 'gemini' || Boolean(data.GEMINI_API_KEY), {
    message: 'EXTRACTION_PROVIDER=gemini requires GEMINI_API_KEY to be set.',
    path: ['GEMINI_API_KEY'],
  })
  .refine((data) => data.EMBEDDING_PROVIDER !== 'gemini' || Boolean(data.GEMINI_API_KEY), {
    message: 'EMBEDDING_PROVIDER=gemini requires GEMINI_API_KEY to be set.',
    path: ['GEMINI_API_KEY'],
  })
  .refine((data) => data.REASONING_PROVIDER !== 'gemini' || Boolean(data.GEMINI_API_KEY), {
    message: 'REASONING_PROVIDER=gemini requires GEMINI_API_KEY to be set.',
    path: ['GEMINI_API_KEY'],
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail loudly and stop — never fall back to fake/default secrets for
  // required security-sensitive configuration.
  console.error('Invalid environment configuration:');
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  throw new Error(
    'Environment validation failed. Copy .env.example to .env at the repo root and fill in real values.',
  );
}

export const env = parsed.data;
