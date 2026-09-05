import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Database } from '@twin/db';

/** A real, valid P-256 EC public key + random auth secret — the same shape a real browser's PushSubscription.getKey() returns. Generated fresh, not a fabricated string, so web-push's real ECDH encryption step actually succeeds/fails the way it would for a genuine subscription. */
function generatePushKeys(): { p256dh: string; auth: string } {
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const rawPoint = der.subarray(der.length - 65);
  return { p256dh: rawPoint.toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
}

/**
 * Real database-backed tests for Phase 47's background worker.
 * Mirrors notifications.integration.test.ts's setup pattern (real
 * Fastify via app.inject for API-surface checks, real Postgres for
 * everything else). runSchedulerCycle is called directly — it's the
 * exact function apps/api/src/worker.ts's setInterval loop calls, so
 * this exercises the real production code path, just without the
 * timer wrapper.
 */

const TEST_DATABASE_URL = process.env.TWIN_TEST_DATABASE_URL ?? 'postgres://twin:twin_dev_password@localhost:5432/twin_test';
const NOOP_LOGGER = { info: () => {}, warn: () => {}, error: () => {} };

describe('Phase 47 worker — real database', () => {
  let app: FastifyInstance;
  let db: Database;

  let runSchedulerCycle: typeof import('../src/worker/scheduler.js').runSchedulerCycle;
  let createEntity: typeof import('../src/modules/entities/entities.service.js').createEntity;
  let createMemory: typeof import('../src/modules/memories/memories.service.js').createMemory;
  let getOrCreatePreferences: typeof import('../src/modules/notifications/notificationsStore.js').getOrCreatePreferences;
  let updatePreferences: typeof import('../src/modules/notifications/notificationsStore.js').updatePreferences;
  let listNotifications: typeof import('../src/modules/notifications/notificationsStore.js').listNotifications;
  let deliverPush: typeof import('../src/worker/push.js').deliverPush;
  let isPushConfigured: typeof import('../src/worker/push.js').isPushConfigured;
  let upsertPushSubscription: typeof import('../src/modules/notifications/notificationsStore.js').upsertPushSubscription;
  let listPushSubscriptionsForUser: typeof import('../src/modules/notifications/notificationsStore.js').listPushSubscriptionsForUser;
  let deleteOwnedPushSubscription: typeof import('../src/modules/notifications/notificationsStore.js').deleteOwnedPushSubscription;

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

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL);
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    db = app.db;

    ({ runSchedulerCycle } = await import('../src/worker/scheduler.js'));
    ({ createEntity } = await import('../src/modules/entities/entities.service.js'));
    ({ createMemory } = await import('../src/modules/memories/memories.service.js'));
    ({ getOrCreatePreferences, updatePreferences, listNotifications, upsertPushSubscription, listPushSubscriptionsForUser, deleteOwnedPushSubscription } =
      await import('../src/modules/notifications/notificationsStore.js'));
    ({ deliverPush, isPushConfigured } = await import('../src/worker/push.js'));

    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Worker Tester', email: `worker-test-${suffix}@twin.test`, password: 'password123' },
    });
    userId = signup.json().user.id;
    userToken = signup.json().accessToken;
    cleanupUserIds.push(userId);

    const otherSignup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Other Worker User', email: `worker-other-${suffix}@twin.test`, password: 'password123' },
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

  describe('eligibility scan', () => {
    it('a user with no notification preferences row is never scanned, and generates nothing', async () => {
      await runSchedulerCycle(db, new Date(), NOOP_LOGGER);
      // otherUserId has no preferences row yet (never called getOrCreatePreferences) — nothing was ever generated for it.
      expect(await listNotifications(db, otherUserId)).toEqual([]);
    });
  });

  describe('Morning Briefing', () => {
    it('an empty account in its morning window produces no notification (no real signal)', async () => {
      await getOrCreatePreferences(db, userId);
      await updatePreferences(db, userId, { morningBriefingEnabled: true, patternAlertsEnabled: false, timezone: 'UTC' });

      // 08:00 UTC is inside the 07:00-09:00 UTC morning window.
      await runSchedulerCycle(db, new Date('2026-06-01T08:00:00.000Z'), NOOP_LOGGER);

      const notifications = await listNotifications(db, userId);
      expect(notifications.filter((n) => n.category === 'morning_briefing')).toHaveLength(0);
    });

    it('real Personal Model data in the morning window produces exactly one real briefing, never a duplicate on re-run', async () => {
      const project = await createEntity(db, userId, { entityType: 'project', name: `workerbriefing${suffix}` });
      await makeMemory({ uid: userId, content: `Working on ${project.name} today.`, entityIds: [project.id], occurredAt: new Date('2026-06-01T07:00:00.000Z') });

      // rebuildPersonalModel only happens via rebuildInsights or the Personal Model's own rebuild path — trigger it the same way the rest of the app does, via the real insights rebuild composition.
      const { rebuildInsights } = await import('../src/modules/insights/insightsStore.js');
      await rebuildInsights(db, userId, new Date('2026-06-01T07:30:00.000Z'));

      const now = new Date('2026-06-01T08:00:00.000Z');
      await runSchedulerCycle(db, now, NOOP_LOGGER);
      const first = (await listNotifications(db, userId)).filter((n) => n.category === 'morning_briefing');
      expect(first).toHaveLength(1);
      expect(first[0]!.body).toContain('active project');

      // Re-running the same cycle for the same local day must not duplicate it.
      await runSchedulerCycle(db, new Date('2026-06-01T08:30:00.000Z'), NOOP_LOGGER);
      const second = (await listNotifications(db, userId)).filter((n) => n.category === 'morning_briefing');
      expect(second).toHaveLength(1);
    });

    it('outside the morning window, no briefing is generated even with real data and the preference enabled', async () => {
      const before = (await listNotifications(db, userId)).filter((n) => n.category === 'morning_briefing').length;
      await runSchedulerCycle(db, new Date('2026-06-01T14:00:00.000Z'), NOOP_LOGGER); // 14:00 UTC — afternoon, outside 07:00-09:00
      const after = (await listNotifications(db, userId)).filter((n) => n.category === 'morning_briefing').length;
      expect(after).toBe(before);
    });

    it('respects the user timezone: a UTC instant outside one zone\'s window but inside another\'s only generates for the eligible zone', async () => {
      await updatePreferences(db, otherUserId, { morningBriefingEnabled: true, patternAlertsEnabled: false, timezone: 'Asia/Tokyo' });
      const project = await createEntity(db, otherUserId, { entityType: 'project', name: `otherworkerbriefing${suffix}` });
      await makeMemory({ uid: otherUserId, content: `Working on ${project.name}.`, entityIds: [project.id], occurredAt: new Date('2026-06-01T00:00:00.000Z') });
      const { rebuildInsights } = await import('../src/modules/insights/insightsStore.js');
      await rebuildInsights(db, otherUserId, new Date('2026-06-01T00:30:00.000Z'));

      // 23:30 UTC on May 31 is 08:30 JST on June 1 — inside Tokyo's morning window, but 23:30 UTC is outside the UTC-timezone user's window.
      const userBriefingsBefore = (await listNotifications(db, userId)).filter((n) => n.category === 'morning_briefing').length;
      const now = new Date('2026-05-31T23:30:00.000Z');
      await runSchedulerCycle(db, now, NOOP_LOGGER);

      const otherBriefings = (await listNotifications(db, otherUserId)).filter((n) => n.category === 'morning_briefing');
      expect(otherBriefings.length).toBeGreaterThanOrEqual(1);

      const userBriefingsAfter = (await listNotifications(db, userId)).filter((n) => n.category === 'morning_briefing').length;
      expect(userBriefingsAfter).toBe(userBriefingsBefore); // UTC user's window (07:00-09:00 UTC) does not include 23:30 UTC
    });

    it('concurrent duplicate invocations for the same period never create two notifications (DB is the idempotency authority)', async () => {
      await updatePreferences(db, otherUserId, { timezone: 'Asia/Tokyo' });
      const now = new Date('2026-06-01T23:00:00.000Z'); // 08:00 JST on 2026-06-02 — inside the 07:00-09:00 window, a new local day
      await Promise.all([runSchedulerCycle(db, now, NOOP_LOGGER), runSchedulerCycle(db, now, NOOP_LOGGER), runSchedulerCycle(db, now, NOOP_LOGGER)]);

      const briefingsForThisDay = (await listNotifications(db, otherUserId)).filter(
        (n) => n.category === 'morning_briefing' && n.dedupeKey?.endsWith('2026-06-02'),
      );
      expect(briefingsForThisDay).toHaveLength(1);
    });
  });

  describe('Evening Thought Synthesis', () => {
    it('no changes today produces no synthesis notification', async () => {
      await updatePreferences(db, userId, { morningBriefingEnabled: false, eveningSynthesisEnabled: true, timezone: 'UTC' });
      await runSchedulerCycle(db, new Date('2026-01-01T20:00:00.000Z'), NOOP_LOGGER); // an evening with zero activity that day
      const synth = (await listNotifications(db, userId)).filter((n) => n.category === 'evening_synthesis');
      expect(synth).toHaveLength(0);
    });

    it('a real Personal Model change today produces exactly one synthesis, never duplicated on re-run', async () => {
      // personal_model_changes.createdAt is always the real wall-clock
      // insertion time (never the memory's fictional occurredAt), so
      // "today" here must be the real current UTC date — only the hour
      // is fixed, to land deterministically inside the evening window.
      const realNow = new Date();
      const evening = new Date(Date.UTC(realNow.getUTCFullYear(), realNow.getUTCMonth(), realNow.getUTCDate(), 20, 0, 0));

      const project = await createEntity(db, userId, { entityType: 'project', name: `workersynth${suffix}` });
      await makeMemory({ uid: userId, content: `Update on ${project.name}.`, entityIds: [project.id], occurredAt: new Date('2026-06-05T10:00:00.000Z') });
      const { rebuildInsights } = await import('../src/modules/insights/insightsStore.js');
      await rebuildInsights(db, userId, realNow);

      await runSchedulerCycle(db, evening, NOOP_LOGGER);
      const first = (await listNotifications(db, userId)).filter((n) => n.category === 'evening_synthesis');
      expect(first).toHaveLength(1);
      expect(first[0]!.body).toContain('change');

      await runSchedulerCycle(db, new Date(evening.getTime() + 30 * 60_000), NOOP_LOGGER);
      const second = (await listNotifications(db, userId)).filter((n) => n.category === 'evening_synthesis');
      expect(second).toHaveLength(1);
    });
  });

  describe('Pattern Recurrence Alerts via the worker', () => {
    it('a real recurring pattern is generated by the worker itself, without any HTTP rebuild call, and links to real insight evidence', async () => {
      await updatePreferences(db, userId, { patternAlertsEnabled: true, morningBriefingEnabled: false, eveningSynthesisEnabled: false });
      const project = await createEntity(db, userId, { entityType: 'project', name: `workerpattern${suffix}` });
      const now = new Date('2026-07-01T00:00:00.000Z');
      for (let i = 0; i < 3; i++) {
        await makeMemory({ uid: userId, content: `Note ${i} on ${project.name}.`, entityIds: [project.id], occurredAt: new Date(now.getTime() - (10 + i) * 86_400_000) });
      }

      await runSchedulerCycle(db, now, NOOP_LOGGER);

      const patternNotifications = (await listNotifications(db, userId)).filter((n) => n.category === 'pattern_recurrence');
      expect(patternNotifications.length).toBeGreaterThanOrEqual(1);
      expect(patternNotifications.some((n) => n.sourceInsightId !== null)).toBe(true);
    });
  });

  describe('failure isolation', () => {
    it('one user with an invalid timezone does not prevent other eligible users from being processed', async () => {
      await updatePreferences(db, otherUserId, { timezone: 'Not/A_Real_Zone', morningBriefingEnabled: true });
      const stats = await runSchedulerCycle(db, new Date('2026-08-01T08:00:00.000Z'), NOOP_LOGGER);
      // Must not throw, and must still report a completed cycle covering every eligible row.
      expect(stats.eligibleUsers).toBeGreaterThanOrEqual(2);
      // restore for cleanliness
      await updatePreferences(db, otherUserId, { timezone: 'UTC' });
    });
  });

  describe('push delivery', () => {
    // Each test needs deliverPush to see EXACTLY the one subscription it
    // creates — otherwise it would also fan out over subscriptions left
    // by earlier tests/describes (e.g. the 'security' block's), making
    // which mocked outcome applies to which endpoint nondeterministic.
    afterEach(async () => {
      for (const sub of await listPushSubscriptionsForUser(db, userId)) {
        await deleteOwnedPushSubscription(db, userId, sub.endpoint);
      }
    });

    // web-push's sendNotification always negotiates real TLS via Node's
    // `https` module, regardless of the subscription endpoint's declared
    // protocol — there is no way to exercise it against a plain local
    // HTTP test server, and standing up a trusted local HTTPS server
    // without an external cert tool is out of scope for this suite. The
    // real network+encryption path (a genuine browser subscription
    // against a genuine push service) is exercised in live browser
    // verification instead (see Phase 47's completion report); these
    // tests cover OUR code's outcome handling by controlling the one
    // real external boundary — the result of web-push's own network
    // call — exactly like this codebase's existing FixtureAIProvider/
    // FixtureEmbeddingProvider pattern controls the Gemini boundary.
    it('a subscription the push service reports as gone (410) is deleted, and stats reflect it', async () => {
      if (!isPushConfigured()) {
        console.warn('VAPID not configured in this environment — skipping (see .env.example).');
        return;
      }
      const webpush = (await import('web-push')).default;
      const spy = vi.spyOn(webpush, 'sendNotification').mockRejectedValueOnce(Object.assign(new Error('Gone'), { statusCode: 410 }));

      const keys = generatePushKeys();
      await upsertPushSubscription(db, userId, { endpoint: `https://push.example.invalid/gone-${suffix}`, p256dh: keys.p256dh, authKey: keys.auth });

      const stats = await deliverPush(db, userId, { id: '00000000-0000-0000-0000-000000000001', title: 'Test', body: 'Test body' });
      expect(stats.attempted).toBe(1);
      expect(stats.invalidRemoved).toBe(1);

      const remaining = await listPushSubscriptionsForUser(db, userId);
      expect(remaining.some((s) => s.endpoint.includes('gone'))).toBe(false);
      spy.mockRestore();
    });

    it('a non-410/404 delivery failure is counted as failed, and the subscription is kept (transient, not permanently invalid)', async () => {
      if (!isPushConfigured()) {
        console.warn('VAPID not configured in this environment — skipping (see .env.example).');
        return;
      }
      const webpush = (await import('web-push')).default;
      const spy = vi.spyOn(webpush, 'sendNotification').mockRejectedValueOnce(new Error('ECONNRESET'));

      const keys = generatePushKeys();
      await upsertPushSubscription(db, userId, { endpoint: `https://push.example.invalid/flaky-${suffix}`, p256dh: keys.p256dh, authKey: keys.auth });

      const stats = await deliverPush(db, userId, { id: '00000000-0000-0000-0000-000000000002', title: 'Test', body: 'Test body' });
      expect(stats.failed).toBe(1);
      expect(stats.invalidRemoved).toBe(0);

      const remaining = await listPushSubscriptionsForUser(db, userId);
      expect(remaining.some((s) => s.endpoint.includes('flaky'))).toBe(true);
      spy.mockRestore();
    });

    it('a real successful push send marks the notification delivered and updates the subscription\'s lastUsedAt', async () => {
      if (!isPushConfigured()) {
        console.warn('VAPID not configured in this environment — skipping (see .env.example).');
        return;
      }
      const webpush = (await import('web-push')).default;
      const spy = vi.spyOn(webpush, 'sendNotification').mockResolvedValueOnce({ statusCode: 201, body: '', headers: {} } as any);

      const keys = generatePushKeys();
      await upsertPushSubscription(db, userId, { endpoint: `https://push.example.invalid/ok-${suffix}`, p256dh: keys.p256dh, authKey: keys.auth });

      const notifications = await listNotifications(db, userId);
      const target = notifications.find((n) => !n.deliveredAt)!;
      const stats = await deliverPush(db, userId, { id: target.id, title: 'Test', body: 'Test body' });
      expect(stats.delivered).toBeGreaterThanOrEqual(1);

      const refreshed = (await listNotifications(db, userId)).find((n) => n.id === target.id)!;
      expect(refreshed.deliveredAt).not.toBeNull();

      const sub = (await listPushSubscriptionsForUser(db, userId)).find((s) => s.endpoint.includes('/ok-'))!;
      expect(sub.lastUsedAt).not.toBeNull();
      spy.mockRestore();
    });
  });

  describe('security', () => {
    it('a user cannot unsubscribe another user\'s push subscription', async () => {
      const endpoint = `https://example.invalid/owned-by-user-${suffix}`;
      await upsertPushSubscription(db, userId, { endpoint, p256dh: 'p256dh-value', authKey: 'auth-value' });

      const res = await app.inject({
        method: 'POST',
        url: '/notifications/push/unsubscribe',
        headers: authHeader(otherToken),
        payload: { endpoint },
      });
      expect(res.statusCode).toBe(204); // the route itself always returns 204 (no leak of existence), but ownership must be enforced underneath

      const remaining = await listPushSubscriptionsForUser(db, userId);
      expect(remaining.some((s) => s.endpoint === endpoint)).toBe(true); // still there — otherUser's call had no effect
    });

    it('the VAPID public key endpoint requires authentication and never exposes the private key', async () => {
      const unauth = await app.inject({ method: 'GET', url: '/notifications/push/vapid-public-key' });
      expect(unauth.statusCode).toBe(401);

      const authed = await app.inject({ method: 'GET', url: '/notifications/push/vapid-public-key', headers: authHeader(userToken) });
      expect(authed.statusCode).toBe(200);
      const body = authed.json();
      expect(typeof body.publicKey === 'string' || body.publicKey === null).toBe(true);
      expect(JSON.stringify(body)).not.toContain('PRIVATE');
    });

    it('scheduled notifications remain fully user-isolated, same as pattern notifications', async () => {
      const userNotifications = await listNotifications(db, userId);
      const otherNotifications = await listNotifications(db, otherUserId);
      const overlap = userNotifications.filter((n) => otherNotifications.some((o) => o.id === n.id));
      expect(overlap).toHaveLength(0);
    });
  });
});
