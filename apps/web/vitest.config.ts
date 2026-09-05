import { defineConfig } from 'vitest/config';

// Phase 21 — mirrors apps/api/vitest.config.ts's minimalism: the web
// app's test suite covers pure, no-DOM logic only (services/*.ts data
// mapping, layout, selection — see graphMapper.test.ts), so a plain
// 'node' environment is enough. No jsdom/React Testing Library is
// introduced by this phase; component rendering stays covered by the
// project's existing browser-verification practice, not a new
// component-test framework.
export default defineConfig({
  test: {
    environment: 'node',
  },
});
