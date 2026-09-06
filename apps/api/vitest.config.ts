import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Test-only defaults so the suite never depends on a developer's
    // local .env or a live database — /health (the only route under
    // test in Phase 1) never touches Postgres. Vitest sets these in
    // process.env before any test module (and therefore config/env.ts's
    // dotenv.config() call, which never overrides an already-set key)
    // runs, so a real GEMINI_API_KEY / EXTRACTION_PROVIDER=gemini in the
    // developer's root .env can never leak into the suite and trigger
    // live, billed, slow network calls as a side effect of running
    // `npm test` — tests that specifically want AI-pipeline coverage
    // inject a FixtureAIProvider (see ai-extraction.integration.test.ts)
    // rather than relying on env-based provider resolution at all.
    env: {
      NODE_ENV: 'test',
      PORT: '4001',
      DATABASE_URL: 'postgres://twin:twin@localhost:5432/twin_test',
      JWT_ACCESS_SECRET: 'test_access_secret_do_not_use_in_prod',
      CORS_ORIGIN: 'http://localhost:3000',
      EXTRACTION_PROVIDER: 'heuristic',
      EMBEDDING_PROVIDER: 'none',
      REASONING_PROVIDER: 'none',
      GEMINI_API_KEY: '',
    },
  },
});
