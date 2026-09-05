import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Database } from '@twin/db';

/**
 * Real database-backed tests for Phase 25's Decision API
 * (apps/api/src/modules/decisions) — decision creation always writing
 * both the entities row and the decisions subtype row, status/outcome
 * updates, evidence/relationship linkage (reusing the same
 * graph.service.getEntityDetail every other entity type uses), the
 * deterministic known/unknown context, and user isolation.
 */

const TEST_DATABASE_URL =
  process.env.TWIN_TEST_DATABASE_URL ?? 'postgres://twin:twin_dev_password@localhost:5432/twin_test';

async function queryOne<T = Record<string, unknown>>(db: Database, query: ReturnType<typeof sql>): Promise<T> {
  const result = await db.execute(query);
  return (result as unknown as { rows: T[] }).rows[0];
}

describe('Phase 25 decisions — real database', () => {
  let app: FastifyInstance;
  let db: Database;
  let createEntity: typeof import('../src/modules/entities/entities.service.js').createEntity;
  let createMemory: typeof import('../src/modules/memories/memories.service.js').createMemory;
  let linkMemoryToEntity: typeof import('../src/modules/memories/memories.service.js').linkMemoryToEntity;
  let upsertRelationshipWithEvidence: typeof import('../src/modules/graph/relationships.service.js').upsertRelationshipWithEvidence;

  let userId: string;
  let userToken: string;
  let otherUserId: string;
  let otherToken: string;
  const cleanupUserIds: string[] = [];

  async function makeMemory(uid: string, content: string): Promise<string> {
    return createMemory(db, uid, {
      source: { sourceType: 'manual' },
      content,
      memoryType: 'note',
      epistemicStatus: 'explicit',
      confidence: 1,
      importance: 3,
    });
  }

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL);

    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    db = app.db;

    ({ createEntity } = await import('../src/modules/entities/entities.service.js'));
    ({ createMemory, linkMemoryToEntity } = await import('../src/modules/memories/memories.service.js'));
    ({ upsertRelationshipWithEvidence } = await import('../src/modules/graph/relationships.service.js'));

    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Decision Tester', email: `decisions-test-${Date.now()}@twin.test`, password: 'password123' },
    });
    userId = signup.json().user.id;
    userToken = signup.json().accessToken;
    cleanupUserIds.push(userId);

    const otherSignup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Other Decision User', email: `decisions-other-${Date.now()}@twin.test`, password: 'password123' },
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

  // -------------------------------------------------------------------------
  // Creation always populates the subtype row (the core Phase 25 gap fix)
  // -------------------------------------------------------------------------

  describe('POST /decisions', () => {
    it('creates both the entity row and the decisions subtype row, defaulting to status=open', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/decisions',
        headers: authHeader(userToken),
        payload: { name: 'Move to a remote-first team', description: 'Considering whether to go fully remote.' },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.name).toBe('Move to a remote-first team');
      expect(body.entityType).toBe('decision');
      expect(body.status).toBe('open');
      expect(body.outcome).toBeNull();
      expect(body.decidedAt).toBeNull();

      const row = await queryOne(db, sql`SELECT status, outcome, decided_at FROM decisions WHERE entity_id = ${body.id}`);
      expect(row.status).toBe('open');
      expect(row.outcome).toBeNull();
    });

    it('Phase 26: a decision can be recorded as already-decided in one step, with an explicit outcome and date', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/decisions',
        headers: authHeader(userToken),
        payload: { name: 'Choose remote-first role', status: 'decided', outcome: 'Accepted the offer', decidedAt: '2026-09-05T00:00:00.000Z' },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.status).toBe('decided');
      expect(body.outcome).toBe('Accepted the offer');
      expect(body.decidedAt).toBe('2026-09-05T00:00:00.000Z');
      expect(body.hasEvidence).toBe(false);
    });

    it('Phase 26: status=decided without an explicit decidedAt at creation still auto-stamps decidedAt', async () => {
      const before = Date.now();
      const response = await app.inject({
        method: 'POST',
        url: '/decisions',
        headers: authHeader(userToken),
        payload: { name: 'Decided At Creation, No Date Given', status: 'decided', outcome: 'Went with it' },
      });
      const body = response.json();
      expect(body.decidedAt).not.toBeNull();
      expect(new Date(body.decidedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    });

    it('rejects an unauthenticated request', async () => {
      const response = await app.inject({ method: 'POST', url: '/decisions', payload: { name: 'x' } });
      expect(response.statusCode).toBe(401);
    });

    it('rejects an empty name', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/decisions',
        headers: authHeader(userToken),
        payload: { name: '' },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Listing + detail
  // -------------------------------------------------------------------------

  describe('GET /decisions and /decisions/:id', () => {
    it('lists only the caller’s own decisions, never another user’s', async () => {
      const mine = await app.inject({
        method: 'POST',
        url: '/decisions',
        headers: authHeader(userToken),
        payload: { name: 'List Test Decision' },
      });
      await app.inject({
        method: 'POST',
        url: '/decisions',
        headers: authHeader(otherToken),
        payload: { name: 'Other User Decision' },
      });

      const response = await app.inject({ method: 'GET', url: '/decisions', headers: authHeader(userToken) });
      expect(response.statusCode).toBe(200);
      const names = response.json().map((d: { name: string }) => d.name);
      expect(names).toContain('List Test Decision');
      expect(names).not.toContain('Other User Decision');
      void mine;
    });

    it('a decision with no evidence returns honest empty states, never fabricated content', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/decisions',
        headers: authHeader(userToken),
        payload: { name: 'Empty Decision' },
      });
      const id = created.json().id;

      const response = await app.inject({ method: 'GET', url: `/decisions/${id}`, headers: authHeader(userToken) });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.relationships).toEqual([]);
      expect(body.supportingMemories).toEqual([]);
      expect(body.context.hasEvidence).toBe(false);
      expect(body.decision.hasEvidence).toBe(false);
      expect(body.context.unknown.length).toBeGreaterThan(0);
      expect(body.context.unknown.join(' ')).toMatch(/no memories have been linked/i);
    });

    it('Phase 26: GET /decisions reports hasEvidence per row without fabricating it for decisions that have none', async () => {
      const noEvidence = await app.inject({
        method: 'POST',
        url: '/decisions',
        headers: authHeader(userToken),
        payload: { name: 'List Evidence Check — No Evidence' },
      });
      const withEvidence = await app.inject({
        method: 'POST',
        url: '/decisions',
        headers: authHeader(userToken),
        payload: { name: 'List Evidence Check — Has Evidence' },
      });
      const memoryId = await makeMemory(userId, 'Evidence for the list hasEvidence check.');
      await linkMemoryToEntity(db, userId, memoryId, withEvidence.json().id, 'related');

      const response = await app.inject({ method: 'GET', url: '/decisions', headers: authHeader(userToken) });
      const rows: { id: string; hasEvidence: boolean }[] = response.json();
      expect(rows.find((r) => r.id === noEvidence.json().id)?.hasEvidence).toBe(false);
      expect(rows.find((r) => r.id === withEvidence.json().id)?.hasEvidence).toBe(true);
    });

    it('returns linked memories and relationships identically to the generic graph entity detail', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/decisions',
        headers: authHeader(userToken),
        payload: { name: 'Evidenced Decision' },
      });
      const decisionId = created.json().id;

      const memoryId = await makeMemory(userId, 'I decided to go with the evidenced decision because of X.');
      await linkMemoryToEntity(db, userId, memoryId, decisionId, 'related');

      const alternative = await createEntity(db, userId, { entityType: 'idea', name: 'Alternative considered' });
      await upsertRelationshipWithEvidence(db, {
        userId,
        fromEntityId: decisionId,
        toEntityId: alternative.id,
        relationshipType: 'considered_alternative',
        epistemicStatus: 'explicit',
        confidence: 1,
        extractionMethod: 'test',
        sourceMemoryId: memoryId,
      });

      const response = await app.inject({ method: 'GET', url: `/decisions/${decisionId}`, headers: authHeader(userToken) });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.supportingMemories).toHaveLength(1);
      expect(body.relationships).toHaveLength(1);
      expect(body.relationships[0].connectedEntity.name).toBe('Alternative considered');
      expect(body.context.hasEvidence).toBe(true);
      expect(body.decision.hasEvidence).toBe(true);
    });

    it('returns 404 for a non-decision entity id (e.g. a person)', async () => {
      const person = await createEntity(db, userId, { entityType: 'person', name: 'Not A Decision' });
      const response = await app.inject({ method: 'GET', url: `/decisions/${person.id}`, headers: authHeader(userToken) });
      expect(response.statusCode).toBe(404);
    });

    it('returns 404 for a non-existent id', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/decisions/00000000-0000-0000-0000-000000000000',
        headers: authHeader(userToken),
      });
      expect(response.statusCode).toBe(404);
    });

    it('security: cannot fetch another user’s decision', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/decisions',
        headers: authHeader(userToken),
        payload: { name: 'Private Decision' },
      });
      const response = await app.inject({
        method: 'GET',
        url: `/decisions/${created.json().id}`,
        headers: authHeader(otherToken),
      });
      expect(response.statusCode).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // Updates — explicit user input only, never inferred
  // -------------------------------------------------------------------------

  describe('PATCH /decisions/:id', () => {
    it('setting status=decided without an explicit decidedAt auto-stamps decidedAt to now', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/decisions',
        headers: authHeader(userToken),
        payload: { name: 'To Be Decided' },
      });
      const id = created.json().id;

      const before = Date.now();
      const response = await app.inject({
        method: 'PATCH',
        url: `/decisions/${id}`,
        headers: authHeader(userToken),
        payload: { status: 'decided', outcome: 'Went with option A' },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('decided');
      expect(body.outcome).toBe('Went with option A');
      expect(body.decidedAt).not.toBeNull();
      expect(new Date(body.decidedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    });

    it('an explicit decidedAt is respected instead of being overwritten with now()', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/decisions',
        headers: authHeader(userToken),
        payload: { name: 'Backdated Decision' },
      });
      const id = created.json().id;
      const explicitDate = '2020-06-15T00:00:00.000Z';

      const response = await app.inject({
        method: 'PATCH',
        url: `/decisions/${id}`,
        headers: authHeader(userToken),
        payload: { status: 'decided', decidedAt: explicitDate },
      });
      expect(response.json().decidedAt).toBe(explicitDate);
    });

    it('rejects a patch with no fields at all', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/decisions',
        headers: authHeader(userToken),
        payload: { name: 'Nothing To Patch' },
      });
      const response = await app.inject({
        method: 'PATCH',
        url: `/decisions/${created.json().id}`,
        headers: authHeader(userToken),
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    });

    it('security: cannot patch another user’s decision', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/decisions',
        headers: authHeader(userToken),
        payload: { name: 'Not Yours To Patch' },
      });
      const response = await app.inject({
        method: 'PATCH',
        url: `/decisions/${created.json().id}`,
        headers: authHeader(otherToken),
        payload: { status: 'decided' },
      });
      expect(response.statusCode).toBe(404);

      // Confirm it genuinely wasn't changed.
      const stillOpen = await queryOne(db, sql`SELECT status FROM decisions WHERE entity_id = ${created.json().id}`);
      expect(stillOpen.status).toBe('open');
    });
  });

  // -------------------------------------------------------------------------
  // Grounded reasoning composition: /reason already accepts decisionEntityId
  // -------------------------------------------------------------------------

  describe('decision "why" composes with the existing /reason endpoint (no parallel reasoning system)', () => {
    it('POST /reason with decisionEntityId returns an honest insufficient-evidence answer for an empty decision', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/decisions',
        headers: authHeader(userToken),
        payload: { name: 'Unexplained Decision' },
      });
      const decisionId = created.json().id;

      const response = await app.inject({
        method: 'POST',
        url: '/reason',
        headers: authHeader(userToken),
        payload: { query: 'Why did I make this decision?', decisionEntityId: decisionId },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.supportLevel).toBe('insufficient_evidence');
      expect(body.citedMemoryIds).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Phase 36 — decision history: a real, append-only record of status/
  // outcome/decidedAt transitions, never fabricated and never lost.
  // -------------------------------------------------------------------------

  describe('GET /decisions/:id/history', () => {
    it('a freshly created decision has no history yet — an honest empty array, not fabricated', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/decisions',
        headers: authHeader(userToken),
        payload: { name: 'Fresh Decision, No History Yet' },
      });
      const response = await app.inject({
        method: 'GET',
        url: `/decisions/${created.json().id}/history`,
        headers: authHeader(userToken),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
    });

    it('a no-op patch (same values) never creates a history row', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/decisions',
        headers: authHeader(userToken),
        payload: { name: 'No-Op Patch Decision', status: 'decided', outcome: 'Kept as is', decidedAt: '2024-01-01T00:00:00.000Z' },
      });
      const id = created.json().id;

      await app.inject({
        method: 'PATCH',
        url: `/decisions/${id}`,
        headers: authHeader(userToken),
        payload: { status: 'decided', outcome: 'Kept as is', decidedAt: '2024-01-01T00:00:00.000Z' },
      });

      const response = await app.inject({ method: 'GET', url: `/decisions/${id}/history`, headers: authHeader(userToken) });
      expect(response.json()).toEqual([]);
    });

    it('a real status/outcome change writes exactly one accurate history row', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/decisions',
        headers: authHeader(userToken),
        payload: { name: 'Decision With Real History' },
      });
      const id = created.json().id;

      await app.inject({
        method: 'PATCH',
        url: `/decisions/${id}`,
        headers: authHeader(userToken),
        payload: { status: 'decided', outcome: 'Went with option A' },
      });

      const response = await app.inject({ method: 'GET', url: `/decisions/${id}/history`, headers: authHeader(userToken) });
      expect(response.statusCode).toBe(200);
      const rows = response.json();
      expect(rows).toHaveLength(1);
      expect(rows[0].previousStatus).toBe('open');
      expect(rows[0].newStatus).toBe('decided');
      expect(rows[0].previousOutcome).toBeNull();
      expect(rows[0].newOutcome).toBe('Went with option A');
    });

    it('multiple real changes accumulate in chronological (oldest-first) order', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/decisions',
        headers: authHeader(userToken),
        payload: { name: 'Multi-Change Decision' },
      });
      const id = created.json().id;

      await app.inject({
        method: 'PATCH',
        url: `/decisions/${id}`,
        headers: authHeader(userToken),
        payload: { status: 'decided', outcome: 'Chose A' },
      });
      await app.inject({
        method: 'PATCH',
        url: `/decisions/${id}`,
        headers: authHeader(userToken),
        payload: { status: 'reversed' },
      });

      const response = await app.inject({ method: 'GET', url: `/decisions/${id}/history`, headers: authHeader(userToken) });
      const rows = response.json();
      expect(rows).toHaveLength(2);
      expect(rows[0].newStatus).toBe('decided');
      expect(rows[1].previousStatus).toBe('decided');
      expect(rows[1].newStatus).toBe('reversed');
      expect(new Date(rows[0].changedAt).getTime()).toBeLessThanOrEqual(new Date(rows[1].changedAt).getTime());
    });

    it('security: cannot view another user’s decision history', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/decisions',
        headers: authHeader(userToken),
        payload: { name: 'Private History Decision' },
      });
      const id = created.json().id;
      await app.inject({
        method: 'PATCH',
        url: `/decisions/${id}`,
        headers: authHeader(userToken),
        payload: { status: 'decided' },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/decisions/${id}/history`,
        headers: authHeader(otherToken),
      });
      expect(response.statusCode).toBe(404);
    });

    it('returns 404 for a non-existent decision id', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/decisions/00000000-0000-0000-0000-000000000000/history',
        headers: authHeader(userToken),
      });
      expect(response.statusCode).toBe(404);
    });

    it('rejects an unauthenticated request', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/decisions',
        headers: authHeader(userToken),
        payload: { name: 'Auth Required History' },
      });
      const response = await app.inject({ method: 'GET', url: `/decisions/${created.json().id}/history` });
      expect(response.statusCode).toBe(401);
    });
  });
});
