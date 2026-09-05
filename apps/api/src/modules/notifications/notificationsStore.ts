import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { notifications, notificationPreferences, pushSubscriptions, type Queryable } from '@twin/db';

export type NotificationRow = typeof notifications.$inferSelect;
export type NotificationPreferencesRow = typeof notificationPreferences.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

export async function listNotifications(db: Queryable, userId: string): Promise<NotificationRow[]> {
  return db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt));
}

export async function countUnread(db: Queryable, userId: string): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return rows.length;
}

async function getOwnedNotification(db: Queryable, userId: string, notificationId: string): Promise<NotificationRow | null> {
  const [row] = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function markRead(db: Queryable, userId: string, notificationId: string, now: Date = new Date()): Promise<NotificationRow | null> {
  const existing = await getOwnedNotification(db, userId, notificationId);
  if (!existing) return null;
  if (existing.readAt) return existing;
  const [updated] = await db
    .update(notifications)
    .set({ readAt: now })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
    .returning();
  return updated ?? null;
}

export async function markAllRead(db: Queryable, userId: string, now: Date = new Date()): Promise<number> {
  const updated = await db
    .update(notifications)
    .set({ readAt: now })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return updated.length;
}

export async function markDelivered(db: Queryable, userId: string, notificationId: string, now: Date = new Date()): Promise<NotificationRow | null> {
  const existing = await getOwnedNotification(db, userId, notificationId);
  if (!existing) return null;
  if (existing.deliveredAt) return existing;
  const [updated] = await db
    .update(notifications)
    .set({ deliveredAt: now })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
    .returning();
  return updated ?? null;
}

/** Worker-side, not user-scoped by design — the worker itself sets delivery outcome after a real push-send attempt, never the frontend. */
export async function markDeliveredById(db: Queryable, notificationId: string, now: Date = new Date()): Promise<void> {
  await db.update(notifications).set({ deliveredAt: now }).where(and(eq(notifications.id, notificationId), isNull(notifications.deliveredAt)));
}

/** Lazily-created, exactly-one-row-per-user preferences — mirrors how Personal Model snapshots are created on first use rather than at signup. */
export async function getOrCreatePreferences(db: Queryable, userId: string): Promise<NotificationPreferencesRow> {
  const [existing] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(notificationPreferences)
    .values({ userId })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  // Lost a create race against a concurrent request — the row now exists.
  const [row] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)).limit(1);
  if (!row) throw new Error('notification_preferences row missing after insert race.');
  return row;
}

export async function updatePreferences(
  db: Queryable,
  userId: string,
  patch: Partial<
    Pick<NotificationPreferencesRow, 'masterEnabled' | 'patternAlertsEnabled' | 'morningBriefingEnabled' | 'eveningSynthesisEnabled' | 'timezone'>
  >,
  now: Date = new Date(),
): Promise<NotificationPreferencesRow> {
  await getOrCreatePreferences(db, userId);
  const [updated] = await db
    .update(notificationPreferences)
    .set({ ...patch, updatedAt: now })
    .where(eq(notificationPreferences.userId, userId))
    .returning();
  if (!updated) throw new Error('notification_preferences update returned no row.');
  return updated;
}

/**
 * The worker's entry point for "which users might have scheduled or
 * background-eligible work right now" — every preferences row where
 * the master switch and at least one category is on. A user who has
 * never touched notification settings has no row here at all (the two
 * scheduled flags default false), so they are correctly never scanned;
 * patternAlertsEnabled defaults true, so a user is included the moment
 * their first getOrCreatePreferences call materializes a row.
 */
export async function listSchedulablePreferences(db: Queryable): Promise<NotificationPreferencesRow[]> {
  return db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.masterEnabled, true),
        or(
          eq(notificationPreferences.morningBriefingEnabled, true),
          eq(notificationPreferences.eveningSynthesisEnabled, true),
          eq(notificationPreferences.patternAlertsEnabled, true),
        ),
      ),
    );
}

/**
 * Idempotent insert: relies on the DB-level unique(sourceInsightId)
 * constraint, not an app-level check-then-insert race. Returns the new
 * row, or null if a notification for this insight already existed.
 */
export async function createFromInsight(
  db: Queryable,
  userId: string,
  args: { category: string; title: string; body: string; sourceInsightId: string },
): Promise<NotificationRow | null> {
  const [created] = await db
    .insert(notifications)
    .values({ userId, ...args })
    .onConflictDoNothing({ target: notifications.sourceInsightId })
    .returning();
  return created ?? null;
}

/**
 * Idempotent insert for scheduled categories (morning_briefing,
 * evening_synthesis): relies on the DB-level unique(dedupeKey)
 * constraint — the actual authority a concurrent/duplicate worker
 * cycle races against, not an app-level check-then-insert. Returns
 * null if a notification for this exact (user, category, local period)
 * already exists.
 */
export async function createScheduled(
  db: Queryable,
  userId: string,
  args: { category: string; title: string; body: string; dedupeKey: string },
): Promise<NotificationRow | null> {
  const [created] = await db
    .insert(notifications)
    .values({ userId, ...args })
    .onConflictDoNothing({ target: notifications.dedupeKey })
    .returning();
  return created ?? null;
}

// --- Push subscriptions ---

export async function upsertPushSubscription(
  db: Queryable,
  userId: string,
  args: { endpoint: string; p256dh: string; authKey: string },
): Promise<PushSubscriptionRow> {
  const [row] = await db
    .insert(pushSubscriptions)
    .values({ userId, ...args })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      // Re-subscribing (e.g. after clearing site data) legitimately
      // rotates keys and can move to a different signed-in user on a
      // shared device — always trust the newest subscribe call.
      set: { userId, p256dh: args.p256dh, authKey: args.authKey, lastUsedAt: null },
    })
    .returning();
  if (!row) throw new Error('push_subscriptions upsert returned no row.');
  return row;
}

/** Ownership-checked delete — a user may only remove their own subscription. Returns true if a row was actually deleted. */
export async function deleteOwnedPushSubscription(db: Queryable, userId: string, endpoint: string): Promise<boolean> {
  const deleted = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
    .returning({ id: pushSubscriptions.id });
  return deleted.length > 0;
}

export async function listPushSubscriptionsForUser(db: Queryable, userId: string): Promise<PushSubscriptionRow[]> {
  return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
}

/** Worker-side cleanup after the push service reports a subscription is gone (404/410) — never a soft-revoke flag, an actually-dead endpoint is actually deleted. */
export async function deletePushSubscriptionById(db: Queryable, subscriptionId: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscriptionId));
}

export async function markPushSubscriptionUsed(db: Queryable, subscriptionId: string, now: Date = new Date()): Promise<void> {
  await db.update(pushSubscriptions).set({ lastUsedAt: now }).where(eq(pushSubscriptions.id, subscriptionId));
}
