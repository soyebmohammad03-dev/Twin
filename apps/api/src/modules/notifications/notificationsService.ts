import { and, eq, inArray } from 'drizzle-orm';
import { notifications, type Queryable } from '@twin/db';
import {
  listNotifications,
  countUnread,
  markRead as storeMarkRead,
  markAllRead as storeMarkAllRead,
  markDelivered as storeMarkDelivered,
  getOrCreatePreferences,
  updatePreferences as storeUpdatePreferences,
  createFromInsight,
  type NotificationRow,
  type NotificationPreferencesRow,
} from './notificationsStore.js';

export class NotificationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 404) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * The only insight types "Pattern Recurrence Alerts" actually covers —
 * real, deterministic pattern/tension detectors (see
 * modules/insights/categories.ts), never 'neglected_goal' (an absence,
 * not a recurrence) or 'cross_insight'/'decision_evolution'/
 * 'goal_target_approaching' (different epistemic shapes with no
 * "recurrence" framing). If a future insight type genuinely represents
 * a recurring pattern, add it here deliberately — never widen this
 * silently.
 */
const PATTERN_INSIGHT_TYPES = ['recurring_topic', 'priority_tension', 'relationship_tension'] as const;

export async function getNotifications(db: Queryable, userId: string): Promise<{ notifications: NotificationRow[]; unreadCount: number }> {
  const [rows, unreadCount] = await Promise.all([listNotifications(db, userId), countUnread(db, userId)]);
  return { notifications: rows, unreadCount };
}

export async function markNotificationRead(db: Queryable, userId: string, notificationId: string): Promise<NotificationRow> {
  const row = await storeMarkRead(db, userId, notificationId);
  if (!row) throw new NotificationError(`Notification not found: ${notificationId}`, 404);
  return row;
}

export async function markAllNotificationsRead(db: Queryable, userId: string): Promise<number> {
  return storeMarkAllRead(db, userId);
}

export async function markNotificationDelivered(db: Queryable, userId: string, notificationId: string): Promise<NotificationRow> {
  const row = await storeMarkDelivered(db, userId, notificationId);
  if (!row) throw new NotificationError(`Notification not found: ${notificationId}`, 404);
  return row;
}

export async function getPreferences(db: Queryable, userId: string): Promise<NotificationPreferencesRow> {
  return getOrCreatePreferences(db, userId);
}

export async function updateNotificationPreferences(
  db: Queryable,
  userId: string,
  patch: { masterEnabled?: boolean; patternAlertsEnabled?: boolean },
): Promise<NotificationPreferencesRow> {
  return storeUpdatePreferences(db, userId, patch);
}

/**
 * The sole notification-generation path in this phase: called after a
 * real insight rebuild (see insights.routes.ts's POST /rebuild) with
 * the insight rows that rebuild just computed as current. Never a
 * timer, never invented — a notification only exists because a real,
 * evidence-backed insight genuinely exists right now.
 *
 * Eligibility, deterministic and in this exact order:
 *  1. preferences.masterEnabled && preferences.patternAlertsEnabled
 *  2. insight.insightType is one of PATTERN_INSIGHT_TYPES
 *  3. insight.dismissedAt is null (a dismissed insight never notifies)
 *  4. no notification already exists for this insightId (DB-level
 *     unique constraint on sourceInsightId — see createFromInsight)
 *
 * title/body are built directly from the insight's own already-
 * templated, deterministic title/description — never separately
 * authored or LLM-generated text.
 */
export async function generatePatternNotifications(
  db: Queryable,
  userId: string,
  currentInsights: { id: string; insightType: string; dismissedAt: Date | null; title: string; description: string }[],
): Promise<NotificationRow[]> {
  const prefs = await getOrCreatePreferences(db, userId);
  if (!prefs.masterEnabled || !prefs.patternAlertsEnabled) return [];

  const eligible = currentInsights.filter(
    (i) => !i.dismissedAt && (PATTERN_INSIGHT_TYPES as readonly string[]).includes(i.insightType),
  );
  if (eligible.length === 0) return [];

  // Skip insights that already have a notification, without racing the
  // DB unique constraint for every row — a plain existence check on the
  // small eligible set, then let the unique constraint be the final
  // authority (onConflictDoNothing in createFromInsight).
  const eligibleIds = eligible.map((i) => i.id);
  const alreadyNotified = await db
    .select({ sourceInsightId: notifications.sourceInsightId })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), inArray(notifications.sourceInsightId, eligibleIds)));
  const alreadyNotifiedIds = new Set(alreadyNotified.map((r) => r.sourceInsightId).filter(Boolean));

  const created: NotificationRow[] = [];
  for (const insight of eligible) {
    if (alreadyNotifiedIds.has(insight.id)) continue;
    const row = await createFromInsight(db, userId, {
      category: 'pattern_recurrence',
      title: insight.title,
      body: insight.description,
      sourceInsightId: insight.id,
    });
    if (row) created.push(row);
  }
  return created;
}
