import type { Database } from '@twin/db';
import { rebuildInsights } from '../modules/insights/insightsStore.js';
import { getCurrentInsights } from '../modules/insights/insightsService.js';
import { generatePatternNotifications } from '../modules/notifications/notificationsService.js';
import type { NotificationPreferencesRow } from '../modules/notifications/notificationsStore.js';

/**
 * The background counterpart to insights.routes.ts's POST /rebuild
 * handler — identical composition (rebuild, then generate), just
 * triggered by the worker's schedule instead of a client request, so
 * Pattern Recurrence Alerts reach a user even when they never opened
 * the app today. Reuses rebuildInsights/getCurrentInsights/
 * generatePatternNotifications directly; no second detector.
 */
export async function tryGeneratePatternNotifications(db: Database, pref: NotificationPreferencesRow, now: Date) {
  await rebuildInsights(db, pref.userId, now);
  const current = await getCurrentInsights(db, pref.userId);
  return generatePatternNotifications(db, pref.userId, current);
}
