import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Database } from '@twin/db';

/**
 * Real database-backed tests for Phase 18's POST /reason endpoint —
 * run against `twin_test`, using MockReasoningProvider (the test env's
 * REASONING_PROVIDER default is 'none' — see vitest.config.ts — so the
 * route falls back to Mock automatically, exactly like production
 * would with no key configured). This deliberately reuses
 * buildContext() (the same function POST /context already uses and
 * already has its own dedicated 51-test suite in
 * context.integration.test.ts) rather than re-testing context assembly
 * here — these tests are about the REASONING layer's own guarantees:
 * the route composes buildContext -> a ReasoningProvider ->
 * validateGroundedResponse correctly, auth/isolation hold at the route
 * boundary, and malformed requests are rejected the same way every
 * other endpoint in this API rejects them.
 */

const TEST_DATABASE_URL =
  process.env.TWIN_TEST_DATABASE_URL ?? 'postgres://twin:twin_dev_password@localhost:5432/twin_test';

describe('POST /reason — real database (MockReasoningProvider)', () => {
  let app: FastifyInstance;
  let db: Database;
  let createEntity: typeof import('../src/modules/entities/entities.service.js').createEntity;
  let createMemory: typeof import('../src/modules/memories/memories.service.js').createMemory;

  let userId: string;
  let userToken: string;
  let otherUserId: string;
  let otherToken: string;
  const cleanupUserIds: string[] = [];
  const suffix = `${Date.now()}`;
  const name = (label: string) => `Reason ${label} ${suffix}`;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL);
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    db = app.db;

    ({ createEntity } = await import('../src/modules/entities/entities.service.js'));
    ({ createMemory } = await import('../src/modules/memories/memories.service.js'));

    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Reason Tester', email: `reason-test-${suffix}@twin.test`, password: 'password123' },
    });
    userId = signup.json().user.id;
    userToken = signup.json().accessToken;
    cleanupUserIds.push(userId);

    const otherSignup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Other Reason User', email: `reason-other-${suffix}@twin.test`, password: 'password123' },
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

  it('returns a well-formed GroundedResponse for a real, grounded query', async () => {
    const project = await createEntity(db, userId, { entityType: 'project', name: name('Zenith') });
    await createMemory(db, userId, {
      source: { sourceType: 'manual' },
      content: `Kicked off ${project.name} with the whole team today.`,
      memoryType: 'note',
      epistemicStatus: 'explicit',
      confidence: 1,
      importance: 3,
      entityLinks: [{ entityId: project.id, role: 'mentioned' }],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/reason',
      headers: authHeader(userToken),
      payload: { query: project.name },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(typeof body.answer).toBe('string');
    expect(['directly_supported', 'partially_supported', 'inferred', 'insufficient_evidence']).toContain(body.supportLevel);
    expect(Array.isArray(body.citedMemoryIds)).toBe(true);
    expect(Array.isArray(body.citedEntityIds)).toBe(true);
    expect(Array.isArray(body.citedPersonalModelFactIds)).toBe(true);
    expect(Array.isArray(body.citedInsightIds)).toBe(true);
    expect(typeof body.confidence).toBe('number');
    expect(body.confidence).toBeGreaterThanOrEqual(0);
    expect(body.confidence).toBeLessThanOrEqual(1);
  });

  it('every citation returned is a real id this same user owns — not a fabricated or cross-user id', async () => {
    const project = await createEntity(db, userId, { entityType: 'project', name: name('Verify Citations') });
    const memId = await createMemory(db, userId, {
      source: { sourceType: 'manual' },
      content: `Progress update on ${project.name}: on track for launch.`,
      memoryType: 'note',
      epistemicStatus: 'explicit',
      confidence: 1,
      importance: 3,
      entityLinks: [{ entityId: project.id, role: 'mentioned' }],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/reason',
      headers: authHeader(userToken),
      payload: { query: project.name },
    });
    const body = response.json();
    if (body.citedMemoryIds.length > 0) {
      expect(body.citedMemoryIds).toContain(memId);
      const rows = await db.query.memories.findMany({ where: (m, { and, eq, inArray }) => and(eq(m.userId, userId), inArray(m.id, body.citedMemoryIds)) });
      expect(rows.length).toBe(body.citedMemoryIds.length);
    }
  });

  it('a query with no matching context returns insufficient_evidence, never a fabricated answer', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/reason',
      headers: authHeader(userToken),
      payload: { query: `completely unrelated nonexistent topic ${suffix}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.supportLevel).toBe('insufficient_evidence');
    expect(body.confidence).toBe(0);
  });

  describe('cross-user isolation (item 9/10.G)', () => {
    it('a same-named entity/memory in another user\'s vault never leaks into this user\'s /reason citations or answer', async () => {
      const sharedName = name('Shared Isolation Project');
      const projMine = await createEntity(db, userId, { entityType: 'project', name: sharedName });
      const projOther = await createEntity(db, otherUserId, { entityType: 'project', name: sharedName });
      await createMemory(db, userId, {
        source: { sourceType: 'manual' },
        content: `My own note about ${sharedName}: budget is $10,000.`,
        memoryType: 'note',
        epistemicStatus: 'explicit',
        confidence: 1,
        importance: 3,
        entityLinks: [{ entityId: projMine.id, role: 'mentioned' }],
      });
      const otherMemId = await createMemory(db, otherUserId, {
        source: { sourceType: 'manual' },
        content: `The OTHER user's private note about ${sharedName}: SECRET-VALUE-${suffix}.`,
        memoryType: 'note',
        epistemicStatus: 'explicit',
        confidence: 1,
        importance: 3,
        entityLinks: [{ entityId: projOther.id, role: 'mentioned' }],
      });

      const response = await app.inject({
        method: 'POST',
        url: '/reason',
        headers: authHeader(userToken),
        payload: { query: sharedName },
      });
      const body = response.json();
      expect(body.citedMemoryIds).not.toContain(otherMemId);
      expect(body.answer).not.toContain(`SECRET-VALUE-${suffix}`);
      expect(body.citedEntityIds).not.toContain(projOther.id);
    });

    it('the other user querying the same shared name gets only their own data back, never the first user\'s', async () => {
      const sharedName = name('Shared Isolation Project'); // same literal name reused from the test above
      const response = await app.inject({
        method: 'POST',
        url: '/reason',
        headers: authHeader(otherToken),
        payload: { query: sharedName },
      });
      const body = response.json();
      expect(body.answer).not.toContain('$10,000');
      const memRows = await db.query.memories.findMany({ where: (m, { eq }) => eq(m.userId, otherUserId) });
      const otherOwnIds = new Set(memRows.map((m) => m.id));
      for (const id of body.citedMemoryIds) {
        expect(otherOwnIds.has(id)).toBe(true);
      }
    });
  });

  describe('validation and auth', () => {
    it('rejects an unauthenticated request', async () => {
      const response = await app.inject({ method: 'POST', url: '/reason', payload: { query: 'anything' } });
      expect(response.statusCode).toBe(401);
    });

    it('rejects an empty query', async () => {
      const response = await app.inject({ method: 'POST', url: '/reason', headers: authHeader(userToken), payload: { query: '' } });
      expect(response.statusCode).toBe(400);
    });

    it('rejects a missing query field', async () => {
      const response = await app.inject({ method: 'POST', url: '/reason', headers: authHeader(userToken), payload: {} });
      expect(response.statusCode).toBe(400);
    });

    it('rejects an extremely long query beyond the 2000-char limit', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/reason',
        headers: authHeader(userToken),
        payload: { query: 'a'.repeat(2001) },
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects a non-uuid targetEntityId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/reason',
        headers: authHeader(userToken),
        payload: { query: 'q', targetEntityId: 'not-a-uuid' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('404s when targetEntityId belongs to another user (reuses ContextError from buildContext, not a new isolation mechanism)', async () => {
      const otherEntity = await createEntity(db, otherUserId, { entityType: 'project', name: name('Not Yours') });
      const response = await app.inject({
        method: 'POST',
        url: '/reason',
        headers: authHeader(userToken),
        payload: { query: 'q', targetEntityId: otherEntity.id },
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
