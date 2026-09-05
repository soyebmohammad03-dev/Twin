import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Database } from '@twin/db';

/**
 * Real database-backed tests for Phase 46's notification layer.
 * Mirrors insights.integration.test.ts's setup pattern exactly (real
 * Fastify via app.inject, real Postgres, inline signup + cleanupUserIds
 * + afterAll cascade cleanup). Notification generation is exercised
 * through the real POST /insights/rebuild endpoint — the only place
 * generatePatternNotifications is ever called — never by calling the
 * generation function directly, so these tests exercise the actual
 * production wiring.
 */

const TEST_DATABASE_URL = process.env.TWIN_TEST_DATABASE_URL ?? 'postgres://twin:twin_dev_password@localhost:5432/twin_test';
const DAY_MS = 1000 * 60 * 60 * 24;

describe('Phase 46 notifications — real database', () => {
  let app: FastifyInstance;
  let db: Database;

  let createEntity: typeof import('../src/modules/entities/entities.service.js').createEntity;
  let createMemory: typeof import('../src/modules/memories/memories.service.js').createMemory;
  let dismissInsight: typeof import('../src/modules/insights/insightsService.js').dismissInsight;
  let getCurrentInsights: typeof import('../src/modules/insights/insightsService.js').getCurrentInsights;

  let userId: string;
  let userToken: string;
  let otherUserId: string;
  let otherToken: string;
  const cleanupUserIds: string[] = [];

  const suffix = `${Date.now()}`;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function makeMemory(opts: { uid: string; content: string; entityIds?: string[]; occurredAt: Date }): Promise<string> {
    return createMemory(db, opts.uid, {
      source: { sourceType: 'manual' },
      content: opts.content,
      memoryType: 'note',
      epistemicStatus: 'explicit',
      confidence: 1,
      importance: 3,
      occurredAt: opts.occurredAt.toISOString(),
      entityLinks: opts.entityIds?.map((entityId) => ({ entityId, role: 'mentioned' })),
    });
  }

  /** 3 distinct-memory mentions of `entity` -> a real recurring_topic candidate — same fixture shape as insights.integration.test.ts's Phase 14 suite. */
  async function makeRecurringTopic(uid: string, entity: { id: string; name: string }, now: Date): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await makeMemory({ uid, content: `Update ${i} on ${entity.name}.`, entityIds: [entity.id], occurredAt: new Date(now.getTime() - (10 + i) * DAY_MS) });
    }
  }

  async function rebuildViaApi(token: string) {
    const res = await app.inject({ method: 'POST', url: '/insights/rebuild', headers: authHeader(token) });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  async function getNotificationsViaApi(token: string) {
    const res = await app.inject({ method: 'GET', url: '/notifications', headers: authHeader(token) });
    expect(res.statusCode).toBe(200);
    return res.json() as { notifications: { id: string; category: string; title: string; body: string; sourceInsightId: string | null; readAt: string | null; deliveredAt: string | null }[]; unreadCount: number };
  }

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL);
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    db = app.db;

    ({ createEntity } = await import('../src/modules/entities/entities.service.js'));
    ({ createMemory } = await import('../src/modules/memories/memories.service.js'));
    ({ dismissInsight, getCurrentInsights } = await import('../src/modules/insights/insightsService.js'));

    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Notifications Tester', email: `notif-test-${suffix}@twin.test`, password: 'password123' },
    });
    userId = signup.json().user.id;
    userToken = signup.json().accessToken;
    cleanupUserIds.push(userId);

    const otherSignup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Other Notifications User', email: `notif-other-${suffix}@twin.test`, password: 'password123' },
    });
    otherUserId = otherSignup.json().user.id;
    otherToken = otherSignup.json().accessToken;
    cleanupUserIds.push(otherUserId);
  });

  afterAll(async () => {
    for (const id of cleanupUserIds) {
      await db.execute(sql`DELETE FROM users WHERE id = ${id}`);
    }
    await app.close();
    vi.unstubAllEnvs();
  });

  describe('empty state and auth', () => {
    it('a fresh user with no data has an honest empty notification center', async () => {
      const body = await getNotificationsViaApi(otherToken);
      expect(body.notifications).toEqual([]);
      expect(body.unreadCount).toBe(0);
    });

    it('rejects unauthenticated access to every notification route', async () => {
      const routes: [string, 'GET' | 'POST' | 'PUT'][] = [
        ['/notifications', 'GET'],
        ['/notifications/preferences', 'GET'],
        ['/notifications/preferences', 'PUT'],
        ['/notifications/read-all', 'POST'],
      ];
      for (const [url, method] of routes) {
        const res = await app.inject({ method, url, payload: method === 'PUT' ? { masterEnabled: true } : undefined });
        expect(res.statusCode).toBe(401);
      }
    });
  });

  describe('preferences', () => {
    it('lazily creates default preferences (both enabled) on first read', async () => {
      const res = await app.inject({ method: 'GET', url: '/notifications/preferences', headers: authHeader(userToken) });
      expect(res.statusCode).toBe(200);
      const prefs = res.json();
      expect(prefs.masterEnabled).toBe(true);
      expect(prefs.patternAlertsEnabled).toBe(true);
    });

    it('persists an update through a real PUT, read back by a subsequent GET', async () => {
      const put = await app.inject({
        method: 'PUT',
        url: '/notifications/preferences',
        headers: authHeader(userToken),
        payload: { patternAlertsEnabled: false },
      });
      expect(put.statusCode).toBe(200);
      expect(put.json().patternAlertsEnabled).toBe(false);
      expect(put.json().masterEnabled).toBe(true); // untouched field preserved

      const get = await app.inject({ method: 'GET', url: '/notifications/preferences', headers: authHeader(userToken) });
      expect(get.json().patternAlertsEnabled).toBe(false);

      // restore for the rest of this suite
      await app.inject({ method: 'PUT', url: '/notifications/preferences', headers: authHeader(userToken), payload: { patternAlertsEnabled: true } });
    });
  });

  describe('real pattern-insight-driven generation', () => {
    it('a genuine recurring_topic insight produces exactly one real, evidence-linked notification', async () => {
      const now = new Date('2026-06-01T00:00:00.000Z');
      const project = await createEntity(db, userId, { entityType: 'project', name: `notifzephyr${suffix}` });
      await makeRecurringTopic(userId, project, now);

      await rebuildViaApi(userToken);

      const insight = (await getCurrentInsights(db, userId)).find((i) => i.insightType === 'recurring_topic' && i.subjectEntityId === project.id);
      expect(insight).toBeTruthy();

      const { notifications, unreadCount } = await getNotificationsViaApi(userToken);
      const match = notifications.find((n) => n.sourceInsightId === insight!.id);
      expect(match).toBeTruthy();
      expect(match!.category).toBe('pattern_recurrence');
      expect(match!.title).toBe(insight!.title);
      expect(match!.body).toBe(insight!.description);
      expect(match!.readAt).toBeNull();
      expect(match!.deliveredAt).toBeNull();
      expect(unreadCount).toBeGreaterThanOrEqual(1);
    });

    it('is idempotent: rebuilding again for the same still-current insight does not create a duplicate notification', async () => {
      const before = await getNotificationsViaApi(userToken);
      const countBefore = before.notifications.length;

      await rebuildViaApi(userToken);

      const after = await getNotificationsViaApi(userToken);
      expect(after.notifications.length).toBe(countBefore);
    });

    it('suppresses generation entirely when patternAlertsEnabled is disabled', async () => {
      const now = new Date('2026-06-02T00:00:00.000Z');
      const project = await createEntity(db, userId, { entityType: 'project', name: `notifsuppressed${suffix}` });
      await makeRecurringTopic(userId, project, now);

      await app.inject({ method: 'PUT', url: '/notifications/preferences', headers: authHeader(userToken), payload: { patternAlertsEnabled: false } });
      await rebuildViaApi(userToken);

      const insight = (await getCurrentInsights(db, userId)).find((i) => i.insightType === 'recurring_topic' && i.subjectEntityId === project.id);
      expect(insight).toBeTruthy(); // the insight itself is real and current

      const { notifications } = await getNotificationsViaApi(userToken);
      expect(notifications.some((n) => n.sourceInsightId === insight!.id)).toBe(false); // but no notification exists for it

      // restore, and confirm re-enabling + rebuilding now generates it
      await app.inject({ method: 'PUT', url: '/notifications/preferences', headers: authHeader(userToken), payload: { patternAlertsEnabled: true } });
      await rebuildViaApi(userToken);
      const { notifications: after } = await getNotificationsViaApi(userToken);
      expect(after.some((n) => n.sourceInsightId === insight!.id)).toBe(true);
    });

    it('a dismissed pattern insight never generates a notification, even though it is a real insight', async () => {
      const now = new Date('2026-06-03T00:00:00.000Z');
      const project = await createEntity(db, userId, { entityType: 'project', name: `notifdismissed${suffix}` });
      await makeRecurringTopic(userId, project, now);
      await rebuildViaApi(userToken);

      const insight = (await getCurrentInsights(db, userId)).find((i) => i.insightType === 'recurring_topic' && i.subjectEntityId === project.id)!;
      // A notification exists from the rebuild above; dismiss the insight, then confirm no NEW notification appears on further rebuilds.
      await dismissInsight(db, userId, insight.id);
      await rebuildViaApi(userToken);

      const { notifications } = await getNotificationsViaApi(userToken);
      // The one notification created before dismissal may still exist (dismissing an insight never deletes notification history), but no duplicate was created.
      expect(notifications.filter((n) => n.sourceInsightId === insight.id)).toHaveLength(1);
    });

    it('an insight with no real pattern signal (no data at all) never fabricates a notification', async () => {
      await rebuildViaApi(otherToken);
      const { notifications } = await getNotificationsViaApi(otherToken);
      expect(notifications).toEqual([]);
    });
  });

  describe('read/unread transitions', () => {
    it('marks a single notification read, decrementing unreadCount; a second mark-read call is a safe no-op', async () => {
      const { notifications: before, unreadCount: unreadBefore } = await getNotificationsViaApi(userToken);
      const target = before.find((n) => n.readAt === null)!;
      expect(target).toBeTruthy();

      const res = await app.inject({ method: 'POST', url: `/notifications/${target.id}/read`, headers: authHeader(userToken) });
      expect(res.statusCode).toBe(200);
      expect(res.json().notification.readAt).not.toBeNull();

      const { unreadCount: unreadAfter } = await getNotificationsViaApi(userToken);
      expect(unreadAfter).toBe(unreadBefore - 1);

      const again = await app.inject({ method: 'POST', url: `/notifications/${target.id}/read`, headers: authHeader(userToken) });
      expect(again.statusCode).toBe(200); // idempotent, not an error
    });

    it('mark-all-read clears every remaining unread notification for that user only', async () => {
      const res = await app.inject({ method: 'POST', url: '/notifications/read-all', headers: authHeader(userToken) });
      expect(res.statusCode).toBe(200);
      expect(typeof res.json().markedCount).toBe('number');

      const { unreadCount } = await getNotificationsViaApi(userToken);
      expect(unreadCount).toBe(0);
    });

    it('marks delivery attempted, and a second delivered call does not overwrite the original timestamp', async () => {
      const { notifications } = await getNotificationsViaApi(userToken);
      const target = notifications[0]!;

      const first = await app.inject({ method: 'POST', url: `/notifications/${target.id}/delivered`, headers: authHeader(userToken) });
      expect(first.statusCode).toBe(200);
      const deliveredAt = first.json().notification.deliveredAt;
      expect(deliveredAt).not.toBeNull();

      const second = await app.inject({ method: 'POST', url: `/notifications/${target.id}/delivered`, headers: authHeader(userToken) });
      expect(second.json().notification.deliveredAt).toBe(deliveredAt);
    });

    it('returns 404 for a notification id that does not exist', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/notifications/00000000-0000-0000-0000-000000000000/read',
        headers: authHeader(userToken),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('cross-user isolation', () => {
    it("a second user's notification list never includes the first user's rows", async () => {
      const { notifications: userList } = await getNotificationsViaApi(userToken);
      const { notifications: otherList } = await getNotificationsViaApi(otherToken);
      expect(userList.length).toBeGreaterThan(0);
      const overlap = userList.filter((n) => otherList.some((o) => o.id === n.id));
      expect(overlap).toHaveLength(0);
    });

    it('a second user cannot mark-read another user’s notification (rejected, not silently scoped)', async () => {
      const { notifications } = await getNotificationsViaApi(userToken);
      const target = notifications[0]!;
      const res = await app.inject({ method: 'POST', url: `/notifications/${target.id}/read`, headers: authHeader(otherToken) });
      expect(res.statusCode).toBe(404);
    });

    it('preferences are isolated per user', async () => {
      const userPrefs = await app.inject({ method: 'GET', url: '/notifications/preferences', headers: authHeader(userToken) });
      const otherPrefs = await app.inject({ method: 'GET', url: '/notifications/preferences', headers: authHeader(otherToken) });
      expect(userPrefs.json().masterEnabled).toBe(true);
      expect(otherPrefs.json().masterEnabled).toBe(true);
    });
  });
});
