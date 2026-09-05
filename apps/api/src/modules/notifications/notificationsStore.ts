import { and, desc, eq, isNull } from 'drizzle-orm';
import { notifications, notificationPreferences, type Queryable } from '@twin/db';

export type NotificationRow = typeof notifications.$inferSelect;
export type NotificationPreferencesRow = typeof notificationPreferences.$inferSelect;

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
  patch: Partial<Pick<NotificationPreferencesRow, 'masterEnabled' | 'patternAlertsEnabled'>>,
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
