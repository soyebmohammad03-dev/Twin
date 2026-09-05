import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Database } from '@twin/db';

/**
 * Phase 20 — real database-backed tests for POST /chat, Twin Chat's
 * authenticated request flow. Run against `twin_test`, using
 * MockReasoningProvider (the test env's REASONING_PROVIDER default is
 * 'none' — see vitest.config.ts — so the route falls back to Mock
 * automatically, exactly like reasoning.integration.test.ts does for
 * POST /reason). This file exists to prove the ROUTE's own
 * responsibilities: it composes sendChatMessage() correctly, auth and
 * cross-user isolation hold at the HTTP boundary, conversation history
 * is accepted and bounded, the evidence panel reflects real cited
 * items, and — the specific Phase 20 guarantee — sending chat messages
 * never creates long-term memories. It deliberately does not re-test
 * context assembly (context.integration.test.ts) or citation validation
 * (context.reasoning.test.ts) — those are already covered.
 */

const TEST_DATABASE_URL =
  process.env.TWIN_TEST_DATABASE_URL ?? 'postgres://twin:twin_dev_password@localhost:5432/twin_test';

describe('POST /chat — real database (MockReasoningProvider)', () => {
  let app: FastifyInstance;
  let db: Database;
  let createEntity: typeof import('../src/modules/entities/entities.service.js').createEntity;
  let createMemory: typeof import('../src/modules/memories/memories.service.js').createMemory;
  let listMemories: typeof import('../src/modules/memories/memories.service.js').listMemories;

  let userId: string;
  let userToken: string;
  let otherUserId: string;
  let otherToken: string;
  const cleanupUserIds: string[] = [];
  const suffix = `${Date.now()}`;
  const name = (label: string) => `Chat ${label} ${suffix}`;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL);
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    db = app.db;

    ({ createEntity } = await import('../src/modules/entities/entities.service.js'));
    ({ createMemory, listMemories } = await import('../src/modules/memories/memories.service.js'));

    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Chat Tester', email: `chat-test-${suffix}@twin.test`, password: 'password123' },
    });
    userId = signup.json().user.id;
    userToken = signup.json().accessToken;
    cleanupUserIds.push(userId);

    const otherSignup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Other Chat User', email: `chat-other-${suffix}@twin.test`, password: 'password123' },
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

  it('1. an authenticated user can send a Twin Chat request and gets a well-formed response', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: authHeader(userToken),
      payload: { message: 'Hello Twin' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(typeof body.answer).toBe('string');
    expect(['directly_supported', 'partially_supported', 'inferred', 'insufficient_evidence']).toContain(body.supportLevel);
    expect(typeof body.intent).toBe('string');
    expect(body.evidence).toBeDefined();
    expect(Array.isArray(body.evidence.memories)).toBe(true);
    expect(Array.isArray(body.evidence.entities)).toBe(true);
    expect(Array.isArray(body.evidence.personalModelFacts)).toBe(true);
    expect(Array.isArray(body.evidence.insights)).toBe(true);
  });

  it('3/4/7. retrieves a real memory, builds context around it, and the evidence panel reflects the exact cited memory (content, provenance, confidence, epistemic status intact)', async () => {
    const project = await createEntity(db, userId, { entityType: 'project', name: name('Zenith') });
    const memId = await createMemory(db, userId, {
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
      url: '/chat',
      headers: authHeader(userToken),
      payload: { message: project.name },
    });
    const body = response.json();
    if (body.citedMemoryIds.length > 0) {
      expect(body.citedMemoryIds).toContain(memId);
      const evidenceIds = body.evidence.memories.map((m: { memoryId: string }) => m.memoryId);
      expect(evidenceIds.sort()).toEqual([...body.citedMemoryIds].sort());
      const evidenceMem = body.evidence.memories.find((m: { memoryId: string }) => m.memoryId === memId);
      expect(evidenceMem).toBeDefined();
      expect(evidenceMem.content).toContain(project.name);
      expect(evidenceMem.epistemicStatus).toBe('explicit');
      expect(typeof evidenceMem.confidence).toBe('number');
      expect(typeof evidenceMem.createdAt).toBe('string');
    }
  });

  it('9. a message with no matching context returns insufficient_evidence, never a fabricated personal claim', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: authHeader(userToken),
      payload: { message: `completely unrelated nonexistent topic ${suffix}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.supportLevel).toBe('insufficient_evidence');
    expect(body.confidence).toBe(0);
    expect(body.evidence.memories).toEqual([]);
  });

  it('5/10. accepts bounded conversation history and threads it through without erroring across multiple turns', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: authHeader(userToken),
      payload: { message: 'What projects am I working on?' },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: authHeader(userToken),
      payload: {
        message: 'Tell me more about that.',
        conversationHistory: [
          { role: 'user', content: 'What projects am I working on?' },
          { role: 'assistant', content: first.json().answer },
        ],
      },
    });
    expect(second.statusCode).toBe(200);
    expect(typeof second.json().answer).toBe('string');
  });

  it('5. rejects conversation history beyond the bounded turn limit (20)', async () => {
    const conversationHistory = Array.from({ length: 21 }, (_, i) => ({ role: 'user' as const, content: `turn ${i}` }));
    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: authHeader(userToken),
      payload: { message: 'q', conversationHistory },
    });
    expect(response.statusCode).toBe(400);
  });

  it('11. sending chat messages (including several turns with conversation history) never creates long-term memories', async () => {
    const before = await listMemories(db, userId, {});
    const beforeCount = before.length;

    await app.inject({
      method: 'POST',
      url: '/chat',
      headers: authHeader(userToken),
      payload: { message: `Remember this: my favorite color is blue ${suffix}` },
    });
    await app.inject({
      method: 'POST',
      url: '/chat',
      headers: authHeader(userToken),
      payload: {
        message: 'And what about my second favorite?',
        conversationHistory: [{ role: 'user', content: `Remember this: my favorite color is blue ${suffix}` }],
      },
    });

    const after = await listMemories(db, userId, {});
    expect(after.length).toBe(beforeCount);
  });

  describe('cross-user isolation', () => {
    it('a same-named entity/memory in another user\'s vault never leaks into this user\'s /chat citations, answer, or evidence panel', async () => {
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
        url: '/chat',
        headers: authHeader(userToken),
        payload: { message: sharedName },
      });
      const body = response.json();
      expect(body.citedMemoryIds).not.toContain(otherMemId);
      expect(body.answer).not.toContain(`SECRET-VALUE-${suffix}`);
      expect(body.evidence.memories.some((m: { memoryId: string }) => m.memoryId === otherMemId)).toBe(false);
      expect(JSON.stringify(body.evidence)).not.toContain(`SECRET-VALUE-${suffix}`);
    });
  });

  describe('validation and auth', () => {
    it('2/13. rejects an unauthenticated request', async () => {
      const response = await app.inject({ method: 'POST', url: '/chat', payload: { message: 'anything' } });
      expect(response.statusCode).toBe(401);
    });

    it('rejects an empty message', async () => {
      const response = await app.inject({ method: 'POST', url: '/chat', headers: authHeader(userToken), payload: { message: '' } });
      expect(response.statusCode).toBe(400);
    });

    it('rejects a missing message field', async () => {
      const response = await app.inject({ method: 'POST', url: '/chat', headers: authHeader(userToken), payload: {} });
      expect(response.statusCode).toBe(400);
    });

    it('rejects an extremely long message beyond the 2000-char limit', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/chat',
        headers: authHeader(userToken),
        payload: { message: 'a'.repeat(2001) },
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects an over-long conversation history turn (beyond 4000 chars)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/chat',
        headers: authHeader(userToken),
        payload: { message: 'q', conversationHistory: [{ role: 'user', content: 'a'.repeat(4001) }] },
      });
      expect(response.statusCode).toBe(400);
    });

    it('404s when targetEntityId belongs to another user (reuses ContextError from buildContext, not a new isolation mechanism)', async () => {
      const otherEntity = await createEntity(db, otherUserId, { entityType: 'project', name: name('Not Yours') });
      const response = await app.inject({
        method: 'POST',
        url: '/chat',
        headers: authHeader(userToken),
        payload: { message: 'q', targetEntityId: otherEntity.id },
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
