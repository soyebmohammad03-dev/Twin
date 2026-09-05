import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Database } from '@twin/db';

/**
 * Real database-backed tests for Phase 7's knowledge graph layer:
 * relationship provenance/evidence accumulation, bounded traversal,
 * the Graph API's HTTP routes, and entity duplicate-safety — run
 * against `twin_test`, no live Gemini calls (see docs/architecture.md
 * for what was separately live-verified).
 */

const TEST_DATABASE_URL =
  process.env.TWIN_TEST_DATABASE_URL ?? 'postgres://twin:twin_dev_password@localhost:5432/twin_test';

/** db.execute() returns a pg QueryResult ({ rows: [...] }), not a bare array. */
async function queryOne<T = Record<string, unknown>>(db: Database, query: ReturnType<typeof sql>): Promise<T> {
  const result = await db.execute(query);
  return (result as unknown as { rows: T[] }).rows[0];
}

describe('Phase 7 knowledge graph — real database', () => {
  let app: FastifyInstance;
  let db: Database;
  let upsertRelationshipWithEvidence: typeof import('../src/modules/graph/relationships.service.js').upsertRelationshipWithEvidence;
  let getRelationshipEvidence: typeof import('../src/modules/graph/relationships.service.js').getRelationshipEvidence;
  let traverseFromEntity: typeof import('../src/modules/graph/traversal.service.js').traverseFromEntity;
  let getEntityDetail: typeof import('../src/modules/graph/graph.service.js').getEntityDetail;
  let createEntity: typeof import('../src/modules/entities/entities.service.js').createEntity;
  let findOrCreateEntity: typeof import('../src/modules/entities/entities.service.js').findOrCreateEntity;
  let createMemory: typeof import('../src/modules/memories/memories.service.js').createMemory;

  let userId: string;
  let userToken: string;
  let userEmail: string;
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

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL);

    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    db = app.db;

    ({ upsertRelationshipWithEvidence, getRelationshipEvidence } = await import(
      '../src/modules/graph/relationships.service.js'
    ));
    ({ traverseFromEntity } = await import('../src/modules/graph/traversal.service.js'));
    ({ getEntityDetail } = await import('../src/modules/graph/graph.service.js'));
    ({ createEntity, findOrCreateEntity } = await import('../src/modules/entities/entities.service.js'));
    ({ createMemory } = await import('../src/modules/memories/memories.service.js'));

    userEmail = `graph-test-${Date.now()}@twin.test`;
    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Graph Tester', email: userEmail, password: 'password123' },
    });
    userId = signup.json().user.id;
    userToken = signup.json().accessToken;
    cleanupUserIds.push(userId);

    const otherSignup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Other Graph User', email: `graph-other-${Date.now()}@twin.test`, password: 'password123' },
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

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  // -------------------------------------------------------------------------
  // Relationship provenance + evidence accumulation
  // -------------------------------------------------------------------------

  describe('upsertRelationshipWithEvidence', () => {
    it('creates a relationship with full provenance on first evidence', async () => {
      const arjun = await createEntity(db, userId, { entityType: 'person', name: 'Provenance Arjun' });
      const drone = await createEntity(db, userId, { entityType: 'project', name: 'Provenance Drone Project' });
      const memoryId = await makeMemory(userId, 'Provenance Arjun works on Provenance Drone Project.');

      const result = await upsertRelationshipWithEvidence(db, {
        userId,
        fromEntityId: arjun.id,
        toEntityId: drone.id,
        relationshipType: 'works_on',
        epistemicStatus: 'explicit',
        confidence: 0.95,
        extractionMethod: 'test',
        sourceMemoryId: memoryId,
        evidenceText: 'Arjun works on the drone project',
      });

      expect(result.relationshipCreated).toBe(true);
      expect(result.evidenceAdded).toBe(true);

      const r = await queryOne(
        db,
        sql`SELECT epistemic_status, confidence, extraction_method, source_memory_id FROM entity_relationships WHERE id = ${result.relationshipId}`,
      );
      expect(r.epistemic_status).toBe('explicit');
      expect(Number(r.confidence)).toBeCloseTo(0.95, 2);
      expect(r.extraction_method).toBe('test');
      expect(r.source_memory_id).toBe(memoryId);
    });

    it('accumulates evidence across multiple memories rather than overwriting', async () => {
      const person = await createEntity(db, userId, { entityType: 'person', name: 'Evidence Accumulation Person' });
      const project = await createEntity(db, userId, { entityType: 'project', name: 'Evidence Accumulation Project' });
      const memory1 = await makeMemory(userId, 'First mention of the relationship.');
      const memory2 = await makeMemory(userId, 'Second, independent mention of the same relationship.');

      const first = await upsertRelationshipWithEvidence(db, {
        userId,
        fromEntityId: person.id,
        toEntityId: project.id,
        relationshipType: 'contributes_to',
        epistemicStatus: 'inferred',
        confidence: 0.5,
        extractionMethod: 'test',
        sourceMemoryId: memory1,
        evidenceText: 'first mention',
      });
      const second = await upsertRelationshipWithEvidence(db, {
        userId,
        fromEntityId: person.id,
        toEntityId: project.id,
        relationshipType: 'contributes_to',
        epistemicStatus: 'inferred',
        confidence: 0.4,
        extractionMethod: 'test',
        sourceMemoryId: memory2,
        evidenceText: 'second mention',
      });

      expect(first.relationshipCreated).toBe(true);
      expect(second.relationshipCreated).toBe(false); // same edge, reused
      expect(second.relationshipId).toBe(first.relationshipId);

      const evidence = await getRelationshipEvidence(db, userId, first.relationshipId);
      expect(evidence).toHaveLength(2);
      expect(evidence.map((e) => e.evidenceText).sort()).toEqual(['first mention', 'second mention']);
    });

    it('is idempotent: the same memory evidencing the same relationship twice does not duplicate evidence', async () => {
      const person = await createEntity(db, userId, { entityType: 'person', name: 'Idempotent Evidence Person' });
      const project = await createEntity(db, userId, { entityType: 'project', name: 'Idempotent Evidence Project' });
      const memoryId = await makeMemory(userId, 'A memory evidencing a relationship, processed twice.');

      const input = {
        userId,
        fromEntityId: person.id,
        toEntityId: project.id,
        relationshipType: 'works_on',
        epistemicStatus: 'explicit' as const,
        confidence: 0.9,
        extractionMethod: 'test',
        sourceMemoryId: memoryId,
        evidenceText: 'same evidence',
      };

      const first = await upsertRelationshipWithEvidence(db, input);
      const second = await upsertRelationshipWithEvidence(db, input);

      expect(first.evidenceAdded).toBe(true);
      expect(second.evidenceAdded).toBe(false);

      const evidence = await getRelationshipEvidence(db, userId, first.relationshipId);
      expect(evidence).toHaveLength(1);
    });

    it('upgrades the rollup when stronger evidence arrives, and preserves the weaker evidence row', async () => {
      const person = await createEntity(db, userId, { entityType: 'person', name: 'Rollup Upgrade Person' });
      const project = await createEntity(db, userId, { entityType: 'project', name: 'Rollup Upgrade Project' });
      const weakMemory = await makeMemory(userId, 'A vague, inferred mention.');
      const strongMemory = await makeMemory(userId, 'An explicit, directly-stated mention.');

      const weak = await upsertRelationshipWithEvidence(db, {
        userId,
        fromEntityId: person.id,
        toEntityId: project.id,
        relationshipType: 'advises',
        epistemicStatus: 'probable',
        confidence: 0.3,
        extractionMethod: 'test',
        sourceMemoryId: weakMemory,
        evidenceText: 'vague mention',
      });
      const strong = await upsertRelationshipWithEvidence(db, {
        userId,
        fromEntityId: person.id,
        toEntityId: project.id,
        relationshipType: 'advises',
        epistemicStatus: 'explicit',
        confidence: 0.9,
        extractionMethod: 'test',
        sourceMemoryId: strongMemory,
        evidenceText: 'explicit mention',
      });

      expect(weak.rollupUpgraded).toBe(false); // nothing to upgrade against yet (this created it)
      expect(strong.rollupUpgraded).toBe(true);

      const r = await queryOne(db, sql`SELECT epistemic_status, confidence FROM entity_relationships WHERE id = ${weak.relationshipId}`);
      expect(r.epistemic_status).toBe('explicit');
      expect(Number(r.confidence)).toBeCloseTo(0.9, 2);

      // Both pieces of evidence remain — the weaker one was never deleted.
      const evidence = await getRelationshipEvidence(db, userId, weak.relationshipId);
      expect(evidence).toHaveLength(2);
      expect(evidence.some((e) => e.epistemicStatus === 'probable')).toBe(true);
      expect(evidence.some((e) => e.epistemicStatus === 'explicit')).toBe(true);
    });

    it('does NOT downgrade the rollup when weaker evidence arrives after stronger evidence', async () => {
      const person = await createEntity(db, userId, { entityType: 'person', name: 'No Downgrade Person' });
      const project = await createEntity(db, userId, { entityType: 'project', name: 'No Downgrade Project' });
      const strongMemory = await makeMemory(userId, 'Explicit statement first.');
      const weakMemory = await makeMemory(userId, 'A weaker, inferred statement second.');

      const strong = await upsertRelationshipWithEvidence(db, {
        userId,
        fromEntityId: person.id,
        toEntityId: project.id,
        relationshipType: 'leads',
        epistemicStatus: 'explicit',
        confidence: 0.9,
        extractionMethod: 'test',
        sourceMemoryId: strongMemory,
      });
      const weak = await upsertRelationshipWithEvidence(db, {
        userId,
        fromEntityId: person.id,
        toEntityId: project.id,
        relationshipType: 'leads',
        epistemicStatus: 'probable',
        confidence: 0.2,
        extractionMethod: 'test',
        sourceMemoryId: weakMemory,
      });

      expect(weak.rollupUpgraded).toBe(false);
      const r = await queryOne(db, sql`SELECT epistemic_status FROM entity_relationships WHERE id = ${strong.relationshipId}`);
      expect(r.epistemic_status).toBe('explicit');
    });

    it('rejects a self-relationship at the database level (no_self_loop check constraint)', async () => {
      const entity = await createEntity(db, userId, { entityType: 'person', name: 'Self Loop Person' });
      const memoryId = await makeMemory(userId, 'Self relationship attempt.');

      await expect(
        upsertRelationshipWithEvidence(db, {
          userId,
          fromEntityId: entity.id,
          toEntityId: entity.id,
          relationshipType: 'works_on',
          epistemicStatus: 'explicit',
          confidence: 1,
          extractionMethod: 'test',
          sourceMemoryId: memoryId,
        }),
      ).rejects.toThrow();
    });

    it('preserves distinct relationship types between the same two entities (works_on and mentored_by both survive)', async () => {
      const a = await createEntity(db, userId, { entityType: 'person', name: 'Multi Rel A' });
      const b = await createEntity(db, userId, { entityType: 'person', name: 'Multi Rel B' });
      const memoryId = await makeMemory(userId, 'A and B have two distinct relationships.');

      await upsertRelationshipWithEvidence(db, {
        userId,
        fromEntityId: a.id,
        toEntityId: b.id,
        relationshipType: 'works_with',
        epistemicStatus: 'explicit',
        confidence: 1,
        extractionMethod: 'test',
        sourceMemoryId: memoryId,
      });
      await upsertRelationshipWithEvidence(db, {
        userId,
        fromEntityId: a.id,
        toEntityId: b.id,
        relationshipType: 'mentored_by',
        epistemicStatus: 'explicit',
        confidence: 1,
        extractionMethod: 'test',
        sourceMemoryId: memoryId,
      });

      const detail = await getEntityDetail(db, userId, a.id);
      const types = detail.relationships.map((r) => r.relationship.relationshipType).sort();
      expect(types).toEqual(['mentored_by', 'works_with']);
    });
  });

  // -------------------------------------------------------------------------
  // Bounded graph traversal
  // -------------------------------------------------------------------------

  describe('traverseFromEntity', () => {
    let a: string, b: string, c: string, isolated: string;

    beforeAll(async () => {
      // A -> B -> C -> A: a genuine cycle, to prove cycle-safety.
      const eA = await createEntity(db, userId, { entityType: 'person', name: 'Cycle Node A' });
      const eB = await createEntity(db, userId, { entityType: 'person', name: 'Cycle Node B' });
      const eC = await createEntity(db, userId, { entityType: 'person', name: 'Cycle Node C' });
      const eIsolated = await createEntity(db, userId, { entityType: 'person', name: 'Isolated Node' });
      a = eA.id;
      b = eB.id;
      c = eC.id;
      isolated = eIsolated.id;

      const memoryId = await makeMemory(userId, 'Cycle graph fixture memory.');
      for (const [from, to, type] of [
        [a, b, 'knows'],
        [b, c, 'knows'],
        [c, a, 'knows'],
      ] as const) {
        await upsertRelationshipWithEvidence(db, {
          userId,
          fromEntityId: from,
          toEntityId: to,
          relationshipType: type,
          epistemicStatus: 'explicit',
          confidence: 1,
          extractionMethod: 'test',
          sourceMemoryId: memoryId,
        });
      }
    });

    it('1-hop traversal from A reaches exactly B and C (not itself)', async () => {
      const nodes = await traverseFromEntity(db, userId, a, { hops: 1 });
      const ids = nodes.map((n) => n.entity.id).sort();
      expect(ids).toEqual([b, c].sort());
      expect(nodes.every((n) => n.hopDistance === 1)).toBe(true);
    });

    it('does not include the starting entity itself in the result', async () => {
      const nodes = await traverseFromEntity(db, userId, a, { hops: 2 });
      expect(nodes.map((n) => n.entity.id)).not.toContain(a);
    });

    it('a cyclic graph terminates and never revisits a node (cycle safety)', async () => {
      const nodes = await traverseFromEntity(db, userId, a, { hops: 2 });
      const ids = nodes.map((n) => n.entity.id);
      expect(new Set(ids).size).toBe(ids.length); // no duplicates
      expect(ids.sort()).toEqual([b, c].sort()); // the cycle closes back to A, which is correctly excluded
    });

    it('hops is capped at MAX_TRAVERSAL_HOPS even if a caller requests more', async () => {
      // @ts-expect-error intentionally passing an out-of-range value to prove the runtime cap, not just the type
      const nodes = await traverseFromEntity(db, userId, a, { hops: 5 });
      // In this 3-node cycle, hop 2 already reaches everything, so this
      // mainly proves the call doesn't error or loop unboundedly.
      expect(nodes.length).toBeLessThanOrEqual(2);
    });

    it('an isolated entity with no relationships returns an empty traversal', async () => {
      const nodes = await traverseFromEntity(db, userId, isolated, { hops: 2 });
      expect(nodes).toEqual([]);
    });

    it('is deterministic: repeated calls return nodes in the same order', async () => {
      const first = await traverseFromEntity(db, userId, a, { hops: 2 });
      const second = await traverseFromEntity(db, userId, a, { hops: 2 });
      expect(first.map((n) => n.entity.id)).toEqual(second.map((n) => n.entity.id));
    });

    it('excludes archived entities from the traversal result', async () => {
      const person = await createEntity(db, userId, { entityType: 'person', name: 'To Be Archived' });
      const project = await createEntity(db, userId, { entityType: 'project', name: 'Archived Traversal Target' });
      const memoryId = await makeMemory(userId, 'Archived-target relationship fixture.');
      await upsertRelationshipWithEvidence(db, {
        userId,
        fromEntityId: person.id,
        toEntityId: project.id,
        relationshipType: 'works_on',
        epistemicStatus: 'explicit',
        confidence: 1,
        extractionMethod: 'test',
        sourceMemoryId: memoryId,
      });
      await db.execute(sql`UPDATE entities SET archived_at = now() WHERE id = ${project.id}`);

      const nodes = await traverseFromEntity(db, userId, person.id, { hops: 1 });
      expect(nodes.map((n) => n.entity.id)).not.toContain(project.id);
    });

    it('user isolation: traversal never crosses into another user’s graph', async () => {
      const otherA = await createEntity(db, otherUserId, { entityType: 'person', name: 'Cycle Node A' });
      const otherB = await createEntity(db, otherUserId, { entityType: 'person', name: 'Other Users Node B' });
      const otherMemoryId = await makeMemory(otherUserId, 'Other user relationship fixture.');
      await upsertRelationshipWithEvidence(db, {
        userId: otherUserId,
        fromEntityId: otherA.id,
        toEntityId: otherB.id,
        relationshipType: 'knows',
        epistemicStatus: 'explicit',
        confidence: 1,
        extractionMethod: 'test',
        sourceMemoryId: otherMemoryId,
      });

      // Traversing from userId's "Cycle Node A" must never reach otherUserId's "Other Users Node B",
      // even though otherA happens to share a name with userId's node.
      const nodes = await traverseFromEntity(db, userId, a, { hops: 2 });
      expect(nodes.map((n) => n.entity.id)).not.toContain(otherB.id);

      // And traversing with userId's session but otherA's id (belongs to a different user) must find nothing.
      const crossUserAttempt = await traverseFromEntity(db, userId, otherA.id, { hops: 2 });
      expect(crossUserAttempt).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Graph API — HTTP routes + security
  // -------------------------------------------------------------------------

  describe('Graph API routes', () => {
    let httpArjun: { id: string };
    let httpDrone: { id: string };
    let httpRelationshipId: string;

    beforeAll(async () => {
      httpArjun = await createEntity(db, userId, { entityType: 'person', name: 'HTTP Arjun' });
      httpDrone = await createEntity(db, userId, { entityType: 'project', name: 'HTTP Drone Project' });
      const memoryId = await makeMemory(userId, 'HTTP Arjun suggested the HTTP Drone Project architecture.');
      const result = await upsertRelationshipWithEvidence(db, {
        userId,
        fromEntityId: httpArjun.id,
        toEntityId: httpDrone.id,
        relationshipType: 'suggested',
        epistemicStatus: 'explicit',
        confidence: 0.9,
        extractionMethod: 'test',
        sourceMemoryId: memoryId,
        evidenceText: 'Arjun suggested the architecture',
      });
      httpRelationshipId = result.relationshipId;
    });

    it('GET /graph/entities/:id returns the entity, its relationships, and supporting memories', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/graph/entities/${httpArjun.id}`,
        headers: authHeader(userToken),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.entity.name).toBe('HTTP Arjun');
      expect(body.relationships).toHaveLength(1);
      expect(body.relationships[0].connectedEntity.name).toBe('HTTP Drone Project');
      expect(body.relationships[0].relationship.epistemicStatus).toBe('explicit');
    });

    it('Phase 40: GET /graph/entities/:id returns null subtype for an entity created via plain createEntity (no subtype row) — honest absence, never a fabricated default', async () => {
      const response = await app.inject({ method: 'GET', url: `/graph/entities/${httpDrone.id}`, headers: authHeader(userToken) });
      expect(response.statusCode).toBe(200);
      expect(response.json().subtype).toBeNull();
    });

    it('Phase 40: GET /graph/entities/:id returns real project subtype data (status, startedAt, completedAt)', async () => {
      const { entity: project } = await findOrCreateEntity(db, userId, { entityType: 'project', name: 'Subtype Project' });
      const response = await app.inject({ method: 'GET', url: `/graph/entities/${project.id}`, headers: authHeader(userToken) });
      expect(response.statusCode).toBe(200);
      expect(response.json().subtype).toEqual({ kind: 'project', status: 'active', startedAt: null, completedAt: null });

      const startedAt = '2026-01-15T00:00:00.000Z';
      await db.execute(sql`UPDATE projects SET started_at = ${startedAt} WHERE entity_id = ${project.id}`);
      const updated = await app.inject({ method: 'GET', url: `/graph/entities/${project.id}`, headers: authHeader(userToken) });
      expect(updated.json().subtype).toEqual({ kind: 'project', status: 'active', startedAt, completedAt: null });
    });

    it('Phase 40: GET /graph/entities/:id returns a goal\'s real target date, never an invented one', async () => {
      const { entity: goal } = await findOrCreateEntity(db, userId, { entityType: 'goal', name: 'Subtype Goal' });
      const noTargetResponse = await app.inject({ method: 'GET', url: `/graph/entities/${goal.id}`, headers: authHeader(userToken) });
      expect(noTargetResponse.json().subtype).toEqual({ kind: 'goal', status: 'active', targetDate: null, achievedAt: null });

      const targetDate = '2026-12-01T00:00:00.000Z';
      await db.execute(sql`UPDATE goals SET target_date = ${targetDate} WHERE entity_id = ${goal.id}`);
      const withTarget = await app.inject({ method: 'GET', url: `/graph/entities/${goal.id}`, headers: authHeader(userToken) });
      expect(withTarget.json().subtype).toEqual({ kind: 'goal', status: 'active', targetDate, achievedAt: null });
    });

    it('Phase 40: GET /graph/entities/:id returns a real event\'s startsAt/endsAt/location', async () => {
      const event = await createEntity(db, userId, { entityType: 'event', name: 'Subtype Event' });
      const startsAt = '2026-03-01T18:00:00.000Z';
      await db.execute(sql`INSERT INTO events (entity_id, starts_at, location) VALUES (${event.id}, ${startsAt}, 'Conference Room A')`);

      const response = await app.inject({ method: 'GET', url: `/graph/entities/${event.id}`, headers: authHeader(userToken) });
      expect(response.statusCode).toBe(200);
      expect(response.json().subtype).toEqual({ kind: 'event', startsAt, endsAt: null, location: 'Conference Room A' });
    });

    it('Phase 40: GET /graph/entities/:id returns null subtype for an "idea" entity, which has no subtype table at all', async () => {
      const idea = await createEntity(db, userId, { entityType: 'idea', name: 'Subtype Idea' });
      const response = await app.inject({ method: 'GET', url: `/graph/entities/${idea.id}`, headers: authHeader(userToken) });
      expect(response.json().subtype).toBeNull();
    });

    it('GET /graph/entities/:id/related returns bounded traversal nodes', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/graph/entities/${httpArjun.id}/related?hops=1`,
        headers: authHeader(userToken),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.nodes.map((n: { entity: { name: string } }) => n.entity.name)).toContain('HTTP Drone Project');
    });

    it('GET /graph/relationships/:id/evidence returns the evidence trail with the originating memory attached', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/graph/relationships/${httpRelationshipId}/evidence`,
        headers: authHeader(userToken),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.evidence).toHaveLength(1);
      expect(body.evidence[0].evidenceText).toBe('Arjun suggested the architecture');
      expect(body.evidence[0].memory).not.toBeNull();
      expect(body.evidence[0].memory.content).toContain('HTTP Arjun suggested');
    });

    it('returns 404 for a non-existent entity id', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/graph/entities/00000000-0000-0000-0000-000000000000',
        headers: authHeader(userToken),
      });
      expect(response.statusCode).toBe(404);
    });

    it('returns 404 for a non-existent relationship id', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/graph/relationships/00000000-0000-0000-0000-000000000000/evidence',
        headers: authHeader(userToken),
      });
      expect(response.statusCode).toBe(404);
    });

    // --- Security: cross-user access ---

    it('security: cannot fetch another user’s entity detail (404, not their data)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/graph/entities/${httpArjun.id}`,
        headers: authHeader(otherToken),
      });
      expect(response.statusCode).toBe(404);
    });

    it('security: cannot traverse from another user’s entity', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/graph/entities/${httpArjun.id}/related`,
        headers: authHeader(otherToken),
      });
      expect(response.statusCode).toBe(404);
    });

    it('security: cannot fetch another user’s relationship evidence', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/graph/relationships/${httpRelationshipId}/evidence`,
        headers: authHeader(otherToken),
      });
      expect(response.statusCode).toBe(404);
    });

    it('security: unauthenticated requests are rejected on every graph route', async () => {
      const responses = await Promise.all([
        app.inject({ method: 'GET', url: `/graph/entities/${httpArjun.id}` }),
        app.inject({ method: 'GET', url: `/graph/entities/${httpArjun.id}/related` }),
        app.inject({ method: 'GET', url: `/graph/relationships/${httpRelationshipId}/evidence` }),
      ]);
      for (const r of responses) {
        expect(r.statusCode).toBe(401);
      }
    });

    it('archived entity behavior: an archived entity can still be fetched by id directly (its own detail), but traversal will not walk further through other archived nodes', async () => {
      const archivable = await createEntity(db, userId, { entityType: 'person', name: 'Archivable HTTP Person' });
      await db.execute(sql`UPDATE entities SET archived_at = now() WHERE id = ${archivable.id}`);

      const response = await app.inject({
        method: 'GET',
        url: `/graph/entities/${archivable.id}`,
        headers: authHeader(userToken),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().entity.archivedAt).not.toBeNull();
    });

    it('deleted/soft-archived memory behavior: relationship evidence still shows the memory content even after it is archived', async () => {
      const person = await createEntity(db, userId, { entityType: 'person', name: 'Evidence Survives Archive' });
      const project = await createEntity(db, userId, { entityType: 'project', name: 'Evidence Survives Archive Project' });
      const memoryId = await makeMemory(userId, 'This memory will be archived after evidencing a relationship.');
      const result = await upsertRelationshipWithEvidence(db, {
        userId,
        fromEntityId: person.id,
        toEntityId: project.id,
        relationshipType: 'works_on',
        epistemicStatus: 'explicit',
        confidence: 1,
        extractionMethod: 'test',
        sourceMemoryId: memoryId,
        evidenceText: 'evidence that survives archiving',
      });

      await app.inject({ method: 'DELETE', url: `/memories/${memoryId}`, headers: authHeader(userToken) });

      const response = await app.inject({
        method: 'GET',
        url: `/graph/relationships/${result.relationshipId}/evidence`,
        headers: authHeader(userToken),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.evidence[0].evidenceText).toBe('evidence that survives archiving');
      expect(body.evidence[0].memory).not.toBeNull(); // still resolvable — soft-archived, not hard-deleted
    });
  });

  // -------------------------------------------------------------------------
  // Phase 27: user-created relationships (POST/DELETE)
  // -------------------------------------------------------------------------

  describe('Phase 27: POST /graph/entities/:id/relationships and DELETE /graph/relationships/:id', () => {
    it('creates an explicit, user-declared relationship between two existing entities', async () => {
      const helios = await createEntity(db, userId, { entityType: 'project', name: 'Project Helios R27' });
      const goal = await createEntity(db, userId, { entityType: 'goal', name: 'Career Goal R27' });

      const response = await app.inject({
        method: 'POST',
        url: `/graph/entities/${helios.id}/relationships`,
        headers: authHeader(userToken),
        payload: { toEntityId: goal.id, relationshipType: 'related_to' },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.relationship.fromEntityId).toBe(helios.id);
      expect(body.relationship.toEntityId).toBe(goal.id);
      expect(body.relationship.relationshipType).toBe('related_to');
      expect(body.relationship.epistemicStatus).toBe('explicit');
      expect(body.relationship.confidence).toBe(1);
      expect(body.relationship.sourceMemoryId).toBeNull();
      expect(body.connectedEntity.name).toBe('Career Goal R27');
      expect(body.direction).toBe('outgoing');

      const row = await queryOne(db, sql`SELECT extraction_method FROM entity_relationships WHERE id = ${body.relationship.id}`);
      expect(row.extraction_method).toBe('user-declared');
    });

    it('the new relationship is immediately visible from GET /graph/entities/:id for both entities', async () => {
      const a = await createEntity(db, userId, { entityType: 'project', name: 'Visible From A' });
      const b = await createEntity(db, userId, { entityType: 'goal', name: 'Visible From B' });
      await app.inject({
        method: 'POST',
        url: `/graph/entities/${a.id}/relationships`,
        headers: authHeader(userToken),
        payload: { toEntityId: b.id, relationshipType: 'related_to' },
      });

      const fromA = await app.inject({ method: 'GET', url: `/graph/entities/${a.id}`, headers: authHeader(userToken) });
      expect(fromA.json().relationships.some((r: { connectedEntity: { name: string } }) => r.connectedEntity.name === 'Visible From B')).toBe(true);

      const fromB = await app.inject({ method: 'GET', url: `/graph/entities/${b.id}`, headers: authHeader(userToken) });
      expect(fromB.json().relationships.some((r: { direction: string; connectedEntity: { name: string } }) => r.direction === 'incoming' && r.connectedEntity.name === 'Visible From A')).toBe(true);
    });

    it('rejects a self-loop with a clean 400, not a raw database error', async () => {
      const solo = await createEntity(db, userId, { entityType: 'idea', name: 'Solo Entity R27' });
      const response = await app.inject({
        method: 'POST',
        url: `/graph/entities/${solo.id}/relationships`,
        headers: authHeader(userToken),
        payload: { toEntityId: solo.id, relationshipType: 'related_to' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects a duplicate (same from/to/type) relationship with 409, not a second row', async () => {
      const a = await createEntity(db, userId, { entityType: 'project', name: 'Dup From R27' });
      const b = await createEntity(db, userId, { entityType: 'goal', name: 'Dup To R27' });
      const first = await app.inject({
        method: 'POST',
        url: `/graph/entities/${a.id}/relationships`,
        headers: authHeader(userToken),
        payload: { toEntityId: b.id, relationshipType: 'related_to' },
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: 'POST',
        url: `/graph/entities/${a.id}/relationships`,
        headers: authHeader(userToken),
        payload: { toEntityId: b.id, relationshipType: 'related_to' },
      });
      expect(second.statusCode).toBe(409);

      const count = await queryOne<{ count: string }>(
        db,
        sql`SELECT count(*)::int as count FROM entity_relationships WHERE from_entity_id = ${a.id} AND to_entity_id = ${b.id} AND relationship_type = 'related_to'`,
      );
      expect(Number(count.count)).toBe(1);
    });

    it('a different relationshipType between the same two entities is allowed (not treated as a duplicate)', async () => {
      const a = await createEntity(db, userId, { entityType: 'project', name: 'Multi Type From R27' });
      const b = await createEntity(db, userId, { entityType: 'goal', name: 'Multi Type To R27' });
      await app.inject({
        method: 'POST',
        url: `/graph/entities/${a.id}/relationships`,
        headers: authHeader(userToken),
        payload: { toEntityId: b.id, relationshipType: 'related_to' },
      });
      const second = await app.inject({
        method: 'POST',
        url: `/graph/entities/${a.id}/relationships`,
        headers: authHeader(userToken),
        payload: { toEntityId: b.id, relationshipType: 'supports' },
      });
      expect(second.statusCode).toBe(201);
    });

    it('rejects a malformed relationshipType (not snake_case)', async () => {
      const a = await createEntity(db, userId, { entityType: 'project', name: 'Malformed From R27' });
      const b = await createEntity(db, userId, { entityType: 'goal', name: 'Malformed To R27' });
      const response = await app.inject({
        method: 'POST',
        url: `/graph/entities/${a.id}/relationships`,
        headers: authHeader(userToken),
        payload: { toEntityId: b.id, relationshipType: 'Related To!' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 404 for a non-existent target entity id', async () => {
      const a = await createEntity(db, userId, { entityType: 'project', name: 'Target Missing R27' });
      const response = await app.inject({
        method: 'POST',
        url: `/graph/entities/${a.id}/relationships`,
        headers: authHeader(userToken),
        payload: { toEntityId: '00000000-0000-0000-0000-000000000000', relationshipType: 'related_to' },
      });
      expect(response.statusCode).toBe(404);
    });

    it('security: cannot create a relationship FROM another user’s entity', async () => {
      const theirs = await createEntity(db, otherUserId, { entityType: 'project', name: 'Other User Project R27' });
      const mine = await createEntity(db, userId, { entityType: 'goal', name: 'My Goal R27' });
      const response = await app.inject({
        method: 'POST',
        url: `/graph/entities/${theirs.id}/relationships`,
        headers: authHeader(userToken),
        payload: { toEntityId: mine.id, relationshipType: 'related_to' },
      });
      expect(response.statusCode).toBe(404);
    });

    it('security: cannot create a relationship TO another user’s entity', async () => {
      const mine = await createEntity(db, userId, { entityType: 'project', name: 'My Project R27' });
      const theirs = await createEntity(db, otherUserId, { entityType: 'goal', name: 'Other User Goal R27' });
      const response = await app.inject({
        method: 'POST',
        url: `/graph/entities/${mine.id}/relationships`,
        headers: authHeader(userToken),
        payload: { toEntityId: theirs.id, relationshipType: 'related_to' },
      });
      expect(response.statusCode).toBe(404);

      const leaked = await queryOne<{ count: string }>(
        db,
        sql`SELECT count(*)::int as count FROM entity_relationships WHERE from_entity_id = ${mine.id}`,
      );
      expect(Number(leaked.count)).toBe(0);
    });

    it('security: unauthenticated requests are rejected', async () => {
      const a = await createEntity(db, userId, { entityType: 'project', name: 'Unauth From R27' });
      const b = await createEntity(db, userId, { entityType: 'goal', name: 'Unauth To R27' });
      const response = await app.inject({
        method: 'POST',
        url: `/graph/entities/${a.id}/relationships`,
        payload: { toEntityId: b.id, relationshipType: 'related_to' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('deletes a relationship the caller owns, without touching either entity or unrelated relationships', async () => {
      const a = await createEntity(db, userId, { entityType: 'project', name: 'Delete From R27' });
      const b = await createEntity(db, userId, { entityType: 'goal', name: 'Delete To R27' });
      const c = await createEntity(db, userId, { entityType: 'idea', name: 'Delete Unrelated R27' });
      const created = await app.inject({
        method: 'POST',
        url: `/graph/entities/${a.id}/relationships`,
        headers: authHeader(userToken),
        payload: { toEntityId: b.id, relationshipType: 'related_to' },
      });
      const unrelated = await app.inject({
        method: 'POST',
        url: `/graph/entities/${a.id}/relationships`,
        headers: authHeader(userToken),
        payload: { toEntityId: c.id, relationshipType: 'related_to' },
      });

      const del = await app.inject({
        method: 'DELETE',
        url: `/graph/relationships/${created.json().relationship.id}`,
        headers: authHeader(userToken),
      });
      expect(del.statusCode).toBe(204);

      // The entities themselves still exist.
      const aStillExists = await app.inject({ method: 'GET', url: `/graph/entities/${a.id}`, headers: authHeader(userToken) });
      expect(aStillExists.statusCode).toBe(200);
      const bStillExists = await app.inject({ method: 'GET', url: `/graph/entities/${b.id}`, headers: authHeader(userToken) });
      expect(bStillExists.statusCode).toBe(200);

      // The unrelated relationship survives.
      const unrelatedStillThere = await queryOne(
        db,
        sql`SELECT id FROM entity_relationships WHERE id = ${unrelated.json().relationship.id}`,
      );
      expect(unrelatedStillThere.id).toBe(unrelated.json().relationship.id);

      // The deleted relationship's evidence rows (none in this case) and the row itself are gone.
      const gone = await queryOne(db, sql`SELECT id FROM entity_relationships WHERE id = ${created.json().relationship.id}`);
      expect(gone).toBeUndefined();
    });

    it('security: cannot delete another user’s relationship (and it is not actually removed)', async () => {
      const a = await createEntity(db, userId, { entityType: 'project', name: 'Cross Delete From R27' });
      const b = await createEntity(db, userId, { entityType: 'goal', name: 'Cross Delete To R27' });
      const created = await app.inject({
        method: 'POST',
        url: `/graph/entities/${a.id}/relationships`,
        headers: authHeader(userToken),
        payload: { toEntityId: b.id, relationshipType: 'related_to' },
      });

      const del = await app.inject({
        method: 'DELETE',
        url: `/graph/relationships/${created.json().relationship.id}`,
        headers: authHeader(otherToken),
      });
      expect(del.statusCode).toBe(404);

      const stillThere = await queryOne(db, sql`SELECT id FROM entity_relationships WHERE id = ${created.json().relationship.id}`);
      expect(stillThere.id).toBe(created.json().relationship.id);
    });

    it('returns 404 for deleting a non-existent relationship id', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/graph/relationships/00000000-0000-0000-0000-000000000000',
        headers: authHeader(userToken),
      });
      expect(response.statusCode).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // Entity duplicate-safety (findOrCreateEntity + POST /entities)
  // -------------------------------------------------------------------------

  describe('entity duplicate-safety', () => {
    it('findOrCreateEntity reuses an entity across case/whitespace/punctuation differences', async () => {
      const first = await findOrCreateEntity(db, userId, { entityType: 'person', name: "D'Angelo Russell" });
      const second = await findOrCreateEntity(db, userId, { entityType: 'person', name: 'dangelo russell' });
      expect(first.wasCreated).toBe(true);
      expect(second.wasCreated).toBe(false);
      expect(second.entity.id).toBe(first.entity.id);
    });

    it('POST /entities returns 201 for a genuinely new entity and 200 for a duplicate submission', async () => {
      const first = await app.inject({
        method: 'POST',
        url: '/entities',
        headers: authHeader(userToken),
        payload: { entityType: 'project', name: 'HTTP Duplicate Test Project' },
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: 'POST',
        url: '/entities',
        headers: authHeader(userToken),
        payload: { entityType: 'project', name: '  http duplicate test project  ' },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().id).toBe(first.json().id);
    });

    it('does not create a duplicate across concurrent requests (database-level race safety)', async () => {
      const payload = { entityType: 'person' as const, name: 'Concurrent Race Person' };
      const results = await Promise.all(
        Array.from({ length: 5 }, () => findOrCreateEntity(db, userId, payload)),
      );
      const uniqueIds = new Set(results.map((r) => r.entity.id));
      expect(uniqueIds.size).toBe(1);
      expect(results.filter((r) => r.wasCreated)).toHaveLength(1);
    });

    it('does not merge distinct names that merely look similar ("Alex" vs "Alex Rivera")', async () => {
      const rivera = await findOrCreateEntity(db, userId, { entityType: 'person', name: 'Alex Rivera' });
      const alex = await findOrCreateEntity(db, userId, { entityType: 'person', name: 'Alex' });
      expect(alex.entity.id).not.toBe(rivera.entity.id);
      expect(alex.wasCreated).toBe(true);
    });

    it('allows the same name to exist again after the original is archived', async () => {
      const first = await findOrCreateEntity(db, userId, { entityType: 'person', name: 'Archivable Name Reuse' });
      await db.execute(sql`UPDATE entities SET archived_at = now() WHERE id = ${first.entity.id}`);

      const second = await findOrCreateEntity(db, userId, { entityType: 'person', name: 'Archivable Name Reuse' });
      expect(second.wasCreated).toBe(true);
      expect(second.entity.id).not.toBe(first.entity.id);
    });
  });
});
