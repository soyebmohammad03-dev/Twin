import { createDatabase } from '@twin/db';
import { env } from './config/env.js';
import { runSchedulerCycle, type WorkerLogger } from './worker/scheduler.js';
import { isPushConfigured } from './worker/push.js';

/**
 * Phase 47 — the background worker: a separate process from the API
 * (`apps/api/src/server.ts`), started independently (`npm run worker`
 * / `node dist/worker.js`), sharing the same Postgres database and the
 * same service-layer code. No Fastify, no HTTP listener, no queue/
 * cron dependency — a plain `setInterval` loop is the correct minimum
 * here because the actual scheduling authority is the database (see
 * notifications.dedupeKey's unique constraint), not this process's
 * uptime. Two workers running simultaneously, or one restarting
 * mid-cycle, cannot produce duplicate notifications — the DB rejects
 * the second insert attempt for the same (user, category, period).
 *
 * Structured, JSON-line logs only — counts and ids, never notification
 * titles/bodies, memory content, or secrets. See scheduler.ts's own
 * comment for the exact contract every call site follows.
 */
const logger: WorkerLogger = {
  info: (obj, msg) => console.log(JSON.stringify({ level: 'info', msg, ...obj, time: new Date().toISOString() })),
  warn: (obj, msg) => console.warn(JSON.stringify({ level: 'warn', msg, ...obj, time: new Date().toISOString() })),
  error: (obj, msg) => console.error(JSON.stringify({ level: 'error', msg, ...obj, time: new Date().toISOString() })),
};

async function main() {
  const { db, pool } = createDatabase(env.DATABASE_URL);

  logger.info({ event: 'worker_started', intervalMs: env.WORKER_INTERVAL_MS, pushConfigured: isPushConfigured() });

  let cycleInFlight = false;
  const timer = setInterval(() => {
    if (cycleInFlight) return; // never overlap a slow cycle with the next tick
    cycleInFlight = true;
    logger.info({ event: 'worker_cycle_started' });
    runSchedulerCycle(db, new Date(), logger)
      .catch((err) => logger.error({ event: 'worker_cycle_fatal_error', message: err instanceof Error ? err.message : String(err) }))
      .finally(() => {
        cycleInFlight = false;
      });
  }, env.WORKER_INTERVAL_MS);

  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ event: 'worker_shutdown_started', signal });
    clearInterval(timer);
    await pool.end();
    logger.info({ event: 'worker_shutdown_complete' });
    process.exit(0);
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ event: 'worker_fatal_startup_error', message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
