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
 *
 * Phase 47 adds: timezone (the smallest correct scheduling input —
 * see the worker's schedule.ts, which converts "now" to this IANA zone
 * before deciding whether a user is in a delivery window) and two more
 * per-category flags now that Morning Briefing / Evening Thought
 * Synthesis have a real generation path (worker/briefing.ts,
 * worker/synthesis.ts) instead of being permanently deferred.
 */
export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  masterEnabled: boolean('master_enabled').notNull().default(true),
  patternAlertsEnabled: boolean('pattern_alerts_enabled').notNull().default(true),
  // Both default false: unlike patternAlertsEnabled (a passive filter
  // on already-real insights), these actively add scheduled interruptions —
  // opt-in, not opt-out, matches the honest "this is new" framing in
  // NotificationSettingsSection.tsx.
  morningBriefingEnabled: boolean('morning_briefing_enabled').notNull().default(false),
  eveningSynthesisEnabled: boolean('evening_synthesis_enabled').notNull().default(false),
  // IANA zone name (e.g. "America/New_York"). Defaults to UTC, never
  // guessed from server location — see notificationsApi.ts's
  // detectAndSyncTimezone, which sends the browser's own
  // Intl.DateTimeFormat().resolvedOptions().timeZone once per session.
  timezone: text('timezone').notNull().default('UTC'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A real, persisted notification. sourceInsightId is the evidence
 * pointer for 'pattern_recurrence' rows: "why did Twin notify me?" is
 * answered by following it to the insight's own evidence trail
 * (insight_evidence), never a separately invented explanation.
 * 'morning_briefing'/'evening_synthesis' rows have no single source
 * insight (they summarize several real facts/insights at once — see
 * worker/briefing.ts) and leave it null.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Open text, matching insights.insightType's convention.
    // 'pattern_recurrence' (Phase 46), 'morning_briefing' and
    // 'evening_synthesis' (Phase 47).
    category: text('category').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    // set null (not cascade): an insight can be hard-deleted by a later
    // rebuild's cleanup lifecycle (see insightsStore.ts) without
    // erasing the notification history that already reached the user —
    // same convention as insight_evidence's own pointer columns.
    sourceInsightId: uuid('source_insight_id').references(() => insights.id, { onDelete: 'set null' }),
    // Phase 47 — the DB-level idempotency key for SCHEDULED categories,
    // e.g. `${userId}:morning_briefing:2026-06-01` (the user's own
    // local calendar date). Null for 'pattern_recurrence' rows, which
    // are already deduplicated by the sourceInsightId unique constraint
    // below — Postgres treats every NULL as distinct, so the two
    // unique constraints never interact. This is the actual authority
    // a worker restart/duplicate cycle relies on: two concurrent
    // attempts to insert the same key race on this constraint, and the
    // loser's onConflictDoNothing simply returns nothing (see
    // notificationsStore.ts's createScheduled).
    dedupeKey: text('dedupe_key'),
    readAt: timestamp('read_at', { withTimezone: true }),
    // Set after a real delivery attempt: either the frontend calling
    // the browser Notification API (foreground), or the worker calling
    // web-push (background). Still honestly null forever if neither
    // ever ran — never set speculatively.
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notifications_user_id_idx').on(table.userId),
    index('notifications_user_id_read_at_idx').on(table.userId, table.readAt),
    unique('notifications_source_insight_unique').on(table.sourceInsightId),
    unique('notifications_dedupe_key_unique').on(table.dedupeKey),
  ],
);

/**
 * Phase 47 — a real Web Push subscription (RFC 8030 / the standard
 * PushSubscription shape: endpoint + the two keys the browser
 * generates). One row per browser+device the user has granted
 * permission on; deleting the row is the actual unsubscribe/revoke
 * mechanism (no soft-revoke flag — a subscription either exists and is
 * usable, or doesn't, matching how the browser's own PushManager
 * works). Deleted outright by the worker on a 404/410 from the push
 * service (the standard "this endpoint is gone" signal — see
 * worker/push.ts), never left around as stale, undeliverable rows.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    authKey: text('auth_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (table) => [index('push_subscriptions_user_id_idx').on(table.userId)],
);
