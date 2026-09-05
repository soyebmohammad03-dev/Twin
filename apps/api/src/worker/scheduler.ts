import type { Database } from '@twin/db';
import { listSchedulablePreferences } from '../modules/notifications/notificationsStore.js';
import { tryGenerateMorningBriefing } from './briefing.js';
import { tryGenerateEveningSynthesis } from './synthesis.js';
import { tryGeneratePatternNotifications } from './patterns.js';
import { deliverPush } from './push.js';

export interface SchedulerCycleStats {
  eligibleUsers: number;
  generated: number;
  suppressedNoSignal: number;
  suppressedDuplicate: number;
  suppressedDisabled: number;
  errors: number;
  deliveryAttempted: number;
  deliveryDelivered: number;
  deliveryFailed: number;
  invalidSubscriptionsRemoved: number;
}

function emptyStats(): SchedulerCycleStats {
  return {
    eligibleUsers: 0,
    generated: 0,
    suppressedNoSignal: 0,
    suppressedDuplicate: 0,
    suppressedDisabled: 0,
    errors: 0,
    deliveryAttempted: 0,
    deliveryDelivered: 0,
    deliveryFailed: 0,
    invalidSubscriptionsRemoved: 0,
  };
}

export interface WorkerLogger {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
}

/**
 * One full scheduler pass: for every user with at least one relevant
 * preference enabled, check each of the three real categories in
 * isolation (Morning Briefing, Evening Thought Synthesis, Pattern
 * Recurrence Alerts) and — if a genuine notification was generated —
 * attempt real Web Push delivery. A failure processing one user is
 * caught, logged, and counted; it never aborts the cycle for anyone
 * else (Phase 47's explicit failure-isolation requirement). Logs are
 * structured and counts-only: no notification title/body, no memory
 * content, ever passed to `logger`.
 */
export async function runSchedulerCycle(db: Database, now: Date, logger: WorkerLogger): Promise<SchedulerCycleStats> {
  const stats = emptyStats();
  const preferences = await listSchedulablePreferences(db);
  stats.eligibleUsers = preferences.length;

  for (const pref of preferences) {
    try {
      const generatedNotifications: { id: string; title: string; body: string }[] = [];

      if (pref.morningBriefingEnabled) {
        const outcome = await tryGenerateMorningBriefing(db, pref, now);
        if (outcome.status === 'generated') {
          stats.generated += 1;
          generatedNotifications.push(outcome.notification);
        } else if (outcome.status === 'suppressed_no_signal') stats.suppressedNoSignal += 1;
        else if (outcome.status === 'duplicate') stats.suppressedDuplicate += 1;
      }

      if (pref.eveningSynthesisEnabled) {
        const outcome = await tryGenerateEveningSynthesis(db, pref, now);
        if (outcome.status === 'generated') {
          stats.generated += 1;
          generatedNotifications.push(outcome.notification);
        } else if (outcome.status === 'suppressed_no_signal') stats.suppressedNoSignal += 1;
        else if (outcome.status === 'duplicate') stats.suppressedDuplicate += 1;
      }

      if (pref.patternAlertsEnabled) {
        const created = await tryGeneratePatternNotifications(db, pref, now);
        stats.generated += created.length;
        generatedNotifications.push(...created);
      }

      for (const notification of generatedNotifications) {
        try {
          const delivery = await deliverPush(db, pref.userId, notification);
          stats.deliveryAttempted += delivery.attempted;
          stats.deliveryDelivered += delivery.delivered;
          stats.deliveryFailed += delivery.failed;
          stats.invalidSubscriptionsRemoved += delivery.invalidRemoved;
        } catch (err) {
          // A push-delivery failure must never roll back or hide the
          // already-persisted notification — it still appears in the
          // notification center, just without background delivery.
          logger.warn({ event: 'worker_push_delivery_error', userId: pref.userId, message: err instanceof Error ? err.message : String(err) });
        }
      }
    } catch (err) {
      stats.errors += 1;
      logger.error({ event: 'worker_user_cycle_error', userId: pref.userId, message: err instanceof Error ? err.message : String(err) });
    }
  }

  logger.info({ event: 'worker_cycle_complete', ...stats });
  return stats;
}
