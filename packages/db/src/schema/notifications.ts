import { pgTable, uuid, text, timestamp, boolean, index, unique } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { insights } from './insights.js';

/**
 * Phase 46 — real, persisted server-side notification preferences.
 * Every other UserPreferences field (theme, biometricLock, etc.) is
 * deliberately client-only, but notification generation happens
 * server-side (triggered by a real insight rebuild — see
 * notifications.service.ts), so "respect the user's preference" is
 * only honestly enforceable if the server can read it. One row per
 * user, created lazily on first read/write — never a second source of
 * truth for anything client-only.
 */
export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  masterEnabled: boolean('master_enabled').notNull().default(true),
  // The only category with a real, deterministic generation signal
  // today (see notifications.service.ts's generatePatternNotifications).
  // Morning Briefing / Evening Thought Synthesis have no backing signal
  // yet and deliberately have no preference column — see Phase 46 notes
  // in apps/web's AccountModal Notifications tab.
  patternAlertsEnabled: boolean('pattern_alerts_enabled').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A real, persisted notification. Every row today is generated from a
 * genuinely new (never-notified-before) pattern-category insight — see
 * generatePatternNotifications. sourceInsightId is the sole evidence
 * pointer: "why did Twin notify me?" is answered by following it to
 * the insight's own evidence trail (insight_evidence), never a
 * separately invented explanation.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Open text, matching insights.insightType's convention. Only
    // 'pattern_recurrence' is emitted today.
    category: text('category').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    // set null (not cascade): an insight can be hard-deleted by a later
    // rebuild's cleanup lifecycle (see insightsStore.ts) without
    // erasing the notification history that already reached the user —
    // same convention as insight_evidence's own pointer columns.
    sourceInsightId: uuid('source_insight_id').references(() => insights.id, { onDelete: 'set null' }),
    readAt: timestamp('read_at', { withTimezone: true }),
    // Set by the frontend after it successfully calls the browser's
    // Notification API for this row — never set server-side, since the
    // server has no way to know whether a browser notification actually
    // displayed. Null forever if the browser tab was never open with
    // permission granted while this row was unread — an honest
    // reflection of this phase's real limitation (no push/service
    // worker infrastructure), not a bug.
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notifications_user_id_idx').on(table.userId),
    index('notifications_user_id_read_at_idx').on(table.userId, table.readAt),
    // Idempotency: at most one notification per insight, ever — a
    // rebuild that sees the same still-current insight again must never
    // create a second notification for it.
    unique('notifications_source_insight_unique').on(table.sourceInsightId),
  ],
);
