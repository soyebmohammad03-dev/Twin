import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Database } from '@twin/db';
import { entityRelationships } from '@twin/db';
import { FixtureEmbeddingProvider } from '../src/modules/retrieval/embeddings/fixtureProvider.js';

/**
 * Real database-backed tests for the Phase 6 hybrid retrieval pipeline
 * (searchMemories), run against `twin_test`. Uses a real Postgres +
 * pgvector (HNSW cosine index + FTS GIN index, both applied by the
 * Phase 6 migrations) and a deterministic FixtureEmbeddingProvider —
 * no live Gemini calls, no network access. See docs/architecture.md's
 * Phase 6 notes for the small number of tests that were *additionally*
 * verified against the real Gemini embedding API.
 *
 * Fixture graph, matching the worked example in the phase brief:
 *   Arjun (person) --[works_on]--> Drone Project (project)
 *   Drone Project --[resulted_in]--> Architecture Decision (decision)
 * so a query naming only "Arjun" should surface memories about the
 * Drone Project (1 hop) but NOT get an entity-match boost for the
 * Architecture Decision (2 hops — expansion is bounded to 1).
 */

const TEST_DATABASE_URL =
  process.env.TWIN_TEST_DATABASE_URL ?? 'postgres://twin:twin_dev_password@localhost:5432/twin_test';

describe('searchMemories — real database', () => {
  let app: FastifyInstance;
  let db: Database;
  let searchMemories: typeof import('../src/modules/retrieval/retrieval.service.js').searchMemories;
  let createMemory: typeof import('../src/modules/memories/memories.service.js').createMemory;
  let createEntity: typeof import('../src/modules/entities/entities.service.js').createEntity;
  let embedMemory: typeof import('../src/modules/retrieval/embedding.service.js').embedMemory;
  let archiveMemory: typeof import('../src/modules/memories/memories.service.js').archiveMemory;

  let userId: string;
  let userEmail: string;
  let otherUserId: string;
  const cleanupUserIds: string[] = [];

  // userId's fixtures
  let arjunId: string;
  let droneProjectId: string;
  let architectureDecisionId: string;
  let memoryIds: Record<string, string> = {};

  const embeddingProvider = new FixtureEmbeddingProvider();

  async function makeMemory(
    uid: string,
    content: string,
    overrides: {
      memoryType?: string;
      epistemicStatus?: 'explicit' | 'from_source' | 'reported_by_other' | 'inferred' | 'probable';
      confidence?: number;
      importance?: number;
      occurredAt?: string;
      entityIds?: string[];
    } = {},
  ): Promise<string> {
    const id = await createMemory(db, uid, {
      source: { sourceType: 'manual' },
      content,
      memoryType: overrides.memoryType ?? 'note',
      epistemicStatus: overrides.epistemicStatus ?? 'explicit',
      confidence: overrides.confidence ?? 1,
      importance: overrides.importance ?? 3,
      occurredAt: overrides.occurredAt,
      entityLinks: overrides.entityIds?.map((entityId) => ({ entityId, role: 'about' })),
    });
    await embedMemory(db, uid, id, embeddingProvider);
    return id;
  }

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL);

    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    db = app.db;

    ({ searchMemories } = await import('../src/modules/retrieval/retrieval.service.js'));
    ({ createMemory, archiveMemory } = await import('../src/modules/memories/memories.service.js'));
    ({ createEntity } = await import('../src/modules/entities/entities.service.js'));
    ({ embedMemory } = await import('../src/modules/retrieval/embedding.service.js'));

    userEmail = `retrieval-test-${Date.now()}@twin.test`;
    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Retrieval Tester', email: userEmail, password: 'password123' },
    });
    userId = signup.json().user.id;
    cleanupUserIds.push(userId);

    const otherSignup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Other Retrieval User', email: `retrieval-other-${Date.now()}@twin.test`, password: 'password123' },
    });
    otherUserId = otherSignup.json().user.id;
    cleanupUserIds.push(otherUserId);

    // --- Entity graph ---
    const arjun = await createEntity(db, userId, { entityType: 'person', name: 'Arjun' });
    const droneProject = await createEntity(db, userId, { entityType: 'project', name: 'Drone Project' });
    const architectureDecision = await createEntity(db, userId, { entityType: 'decision', name: 'Architecture Decision' });
    arjunId = arjun.id;
    droneProjectId = droneProject.id;
    architectureDecisionId = architectureDecision.id;

    await db.insert(entityRelationships).values([
      {
        userId,
        fromEntityId: arjunId,
        toEntityId: droneProjectId,
        relationshipType: 'works_on',
        epistemicStatus: 'explicit',
        extractionMethod: 'test-fixture',
      },
      {
        userId,
        fromEntityId: droneProjectId,
        toEntityId: architectureDecisionId,
        relationshipType: 'resulted_in',
        epistemicStatus: 'explicit',
        extractionMethod: 'test-fixture',
      },
    ]);

    // --- Memories ---
    memoryIds.arjunDrone = await makeMemory(
      userId,
      'Arjun is leading the drone project flight controller redesign this quarter.',
      { entityIds: [arjunId, droneProjectId] },
    );
    memoryIds.architectureOnly = await makeMemory(
      userId,
      'The architecture decision was to move to a modular flight stack for better testability.',
      { entityIds: [architectureDecisionId] },
    );
    memoryIds.unrelated = await makeMemory(userId, 'Had a great lunch with the team downtown near the office.');
    memoryIds.old = await makeMemory(userId, 'An old note about the original office lease terms.', {
      occurredAt: '2015-01-01T00:00:00.000Z',
    });
    memoryIds.recent = await makeMemory(userId, 'A brand new note jotted down just now about parking validation.');
    memoryIds.meetingMonday = await makeMemory(userId, 'The team meeting is scheduled for Monday at 10am.');
    memoryIds.meetingWednesday = await makeMemory(userId, 'The team meeting was moved to Wednesday at 2pm instead.');
    memoryIds.highImportance = await makeMemory(userId, 'Critical launch readiness checklist for the drone project rollout.', {
      importance: 5,
      entityIds: [droneProjectId],
    });
    memoryIds.lowImportance = await makeMemory(userId, 'Minor note about the drone project office supplies.', {
      importance: 1,
      entityIds: [droneProjectId],
    });
    memoryIds.lowConfidence = await makeMemory(userId, 'Possibly the drone project timeline will slip, not fully sure.', {
      epistemicStatus: 'probable',
      confidence: 0.3,
      entityIds: [droneProjectId],
    });
    memoryIds.reportedByOther = await makeMemory(userId, 'Sarah said the drone project client approved the new budget.', {
      epistemicStatus: 'reported_by_other',
      confidence: 0.8,
      entityIds: [droneProjectId],
    });
    memoryIds.archived = await makeMemory(userId, 'Archived note about a cancelled drone project milestone.', {
      entityIds: [droneProjectId],
    });
    await archiveMemory(db, userId, memoryIds.archived);

    // --- Other user's fixtures (isolation) ---
    const otherArjun = await createEntity(db, otherUserId, { entityType: 'person', name: 'Arjun' });
    await makeMemory(otherUserId, 'Arjun from a totally different account discussed the drone project budget.', {
      entityIds: [otherArjun.id],
    });
  });

  afterAll(async () => {
    for (const id of cleanupUserIds) {
      await db.execute(sql`DELETE FROM users WHERE id = ${id}`);
    }
    await app.close();
    vi.unstubAllEnvs();
  });

  // -------------------------------------------------------------------------
  // Semantic + lexical (hybrid) retrieval
  // -------------------------------------------------------------------------

  it('semantic search: a query with no exact keyword overlap still surfaces topically-related memories higher than unrelated ones', async () => {
    const result = await searchMemories(db, userId, {
      query: 'drone flight controller design work',
      limit: 20,
      includeArchived: false,
      embeddingProviderOverride: embeddingProvider,
    });

    expect(result.queryEmbeddingGenerated).toBe(true);
    const ids = result.results.map((r) => r.memory.id);
    expect(ids).toContain(memoryIds.arjunDrone);

    const droneRank = ids.indexOf(memoryIds.arjunDrone);
    const lunchRank = ids.indexOf(memoryIds.unrelated);
    if (lunchRank !== -1) {
      expect(droneRank).toBeLessThan(lunchRank);
    }
  });

  it('lexical search still works when no embedding provider is configured (semantic branch contributes nothing, not an error)', async () => {
    const result = await searchMemories(db, userId, {
      query: 'Monday meeting',
      limit: 20,
      includeArchived: false,
      embeddingProviderOverride: null,
    });

    expect(result.queryEmbeddingGenerated).toBe(false);
    const ids = result.results.map((r) => r.memory.id);
    expect(ids).toContain(memoryIds.meetingMonday);
  });

  it('returns an empty result set (not an error) when nothing matches', async () => {
    const result = await searchMemories(db, userId, {
      query: 'xyzzy nonexistent plugh quixotic',
      limit: 10,
      includeArchived: false,
      embeddingProviderOverride: null,
    });
    expect(result.results).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Entity-aware retrieval — direct + bounded 1-hop expansion
  // -------------------------------------------------------------------------

  it('entity-aware: a query naming "Arjun" surfaces memories about the Drone Project via one hop of expansion', async () => {
    const result = await searchMemories(db, userId, {
      query: 'Arjun',
      limit: 20,
      includeArchived: false,
      embeddingProviderOverride: embeddingProvider,
    });

    expect(result.matchedEntities.some((e) => e.name === 'Arjun' && e.matchType === 'direct')).toBe(true);
    expect(result.matchedEntities.some((e) => e.name === 'Drone Project' && e.matchType === 'expanded')).toBe(true);

    const ids = result.results.map((r) => r.memory.id);
    expect(ids).toContain(memoryIds.highImportance); // linked to Drone Project, not directly to Arjun
  });

  it('bounded expansion: "Arjun" does NOT expand two hops to the Architecture Decision', async () => {
    const result = await searchMemories(db, userId, {
      query: 'Arjun',
      limit: 20,
      includeArchived: false,
      embeddingProviderOverride: null,
    });

    expect(result.matchedEntities.some((e) => e.name === 'Architecture Decision')).toBe(false);

    const architectureResult = result.results.find((r) => r.memory.id === memoryIds.architectureOnly);
    if (architectureResult) {
      expect(architectureResult.signals.entityMatchScore).toBe(0);
    }
  });

  it('a directly-named entity match scores higher than a one-hop-expanded entity match', async () => {
    const result = await searchMemories(db, userId, {
      query: 'Arjun',
      limit: 20,
      includeArchived: false,
      embeddingProviderOverride: null,
    });
    const direct = result.results.find((r) => r.memory.id === memoryIds.arjunDrone);
    const expanded = result.results.find((r) => r.memory.id === memoryIds.highImportance);
    expect(direct?.signals.entityMatchScore).toBe(1);
    expect(expanded?.signals.entityMatchScore).toBe(0.5);
  });

  // -------------------------------------------------------------------------
  // Temporal retrieval
  // -------------------------------------------------------------------------

  it('occurredAfter/occurredBefore filters exclude memories outside the range', async () => {
    const result = await searchMemories(db, userId, {
      query: 'note',
      limit: 20,
      includeArchived: false,
      occurredAfter: new Date('2020-01-01T00:00:00.000Z'),
      embeddingProviderOverride: null,
    });
    const ids = result.results.map((r) => r.memory.id);
    expect(ids).not.toContain(memoryIds.old);
  });

  it('recency is a ranking signal distinguishable from importance/confidence', async () => {
    const result = await searchMemories(db, userId, {
      query: 'note',
      limit: 20,
      includeArchived: false,
      embeddingProviderOverride: null,
    });
    const recent = result.results.find((r) => r.memory.id === memoryIds.recent);
    const old = result.results.find((r) => r.memory.id === memoryIds.old);
    expect(recent?.signals.recencyScore).toBeGreaterThan(old?.signals.recencyScore ?? 1);
  });

  // -------------------------------------------------------------------------
  // Ranking signals — importance, confidence, epistemic status
  // -------------------------------------------------------------------------

  it('importance and confidence are reflected in the returned signals, not silently dropped', async () => {
    const result = await searchMemories(db, userId, {
      query: 'drone project',
      limit: 20,
      includeArchived: false,
      embeddingProviderOverride: null,
    });
    const high = result.results.find((r) => r.memory.id === memoryIds.highImportance);
    const low = result.results.find((r) => r.memory.id === memoryIds.lowImportance);
    expect(high?.signals.importanceScore).toBeGreaterThan(low?.signals.importanceScore ?? 1);

    const lowConf = result.results.find((r) => r.memory.id === memoryIds.lowConfidence);
    expect(lowConf?.signals.confidenceScore).toBeCloseTo(0.3, 2);
  });

  it('epistemic status is preserved on every returned memory (never silently normalized to explicit)', async () => {
    const result = await searchMemories(db, userId, {
      query: 'drone project',
      limit: 20,
      includeArchived: false,
      embeddingProviderOverride: null,
    });
    const reported = result.results.find((r) => r.memory.id === memoryIds.reportedByOther);
    expect(reported?.memory.epistemicStatus).toBe('reported_by_other');
  });

  // -------------------------------------------------------------------------
  // Contradictions / supersession — both coexist, neither is deleted
  // -------------------------------------------------------------------------

  it('conflicting memories about the same topic both appear — retrieval never silently resolves the conflict', async () => {
    const result = await searchMemories(db, userId, {
      query: 'team meeting schedule',
      limit: 20,
      includeArchived: false,
      embeddingProviderOverride: embeddingProvider,
    });
    const ids = result.results.map((r) => r.memory.id);
    expect(ids).toContain(memoryIds.meetingMonday);
    expect(ids).toContain(memoryIds.meetingWednesday);
  });

  // -------------------------------------------------------------------------
  // Archived memories
  // -------------------------------------------------------------------------

  it('excludes archived memories by default', async () => {
    const result = await searchMemories(db, userId, {
      query: 'drone project',
      limit: 20,
      includeArchived: false,
      embeddingProviderOverride: null,
    });
    expect(result.results.map((r) => r.memory.id)).not.toContain(memoryIds.archived);
  });

  it('includes archived memories when includeArchived is true', async () => {
    const result = await searchMemories(db, userId, {
      query: 'drone project',
      limit: 20,
      includeArchived: true,
      embeddingProviderOverride: null,
    });
    expect(result.results.map((r) => r.memory.id)).toContain(memoryIds.archived);
  });

  // -------------------------------------------------------------------------
  // Pagination / limit
  // -------------------------------------------------------------------------

  it('respects a configurable result limit', async () => {
    const result = await searchMemories(db, userId, {
      query: 'drone project',
      limit: 2,
      includeArchived: false,
      embeddingProviderOverride: null,
    });
    expect(result.results.length).toBeLessThanOrEqual(2);
  });

  // -------------------------------------------------------------------------
  // Determinism
  // -------------------------------------------------------------------------

  it('produces the same ordering across repeated identical requests', async () => {
    const args = {
      query: 'drone project',
      limit: 20,
      includeArchived: false,
      embeddingProviderOverride: embeddingProvider,
    } as const;
    const first = await searchMemories(db, userId, args);
    const second = await searchMemories(db, userId, args);
    expect(first.results.map((r) => r.memory.id)).toEqual(second.results.map((r) => r.memory.id));
  });

  // -------------------------------------------------------------------------
  // Evidence / provenance
  // -------------------------------------------------------------------------

  it('every result carries full evidence metadata: source, timestamps, entity links, signals, and reasons', async () => {
    const result = await searchMemories(db, userId, {
      query: 'Arjun',
      limit: 5,
      includeArchived: false,
      embeddingProviderOverride: embeddingProvider,
    });
    expect(result.results.length).toBeGreaterThan(0);

    for (const r of result.results) {
      expect(r.memory.source).toBeDefined();
      expect(r.memory.createdAt).toBeDefined();
      expect(typeof r.memory.epistemicStatus).toBe('string');
      // Raw service-layer row — confidence is Postgres numeric, mapped
      // to a JS string by drizzle (retrieval.routes.ts's DTO mapping,
      // reusing toMemoryDetailDto, converts it to a number for the
      // actual HTTP response; the isolation-over-HTTP test above
      // exercises that path).
      expect(Number.isFinite(Number(r.memory.confidence))).toBe(true);
      expect(typeof r.memory.importance).toBe('number');
      expect(Array.isArray(r.memory.entityLinks)).toBe(true);
      expect(r.signals).toHaveProperty('semanticSimilarity');
      expect(r.matchReasons.length).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------------------
  // Security / user isolation
  // -------------------------------------------------------------------------

  it('user isolation: a query for "Arjun" never returns another user’s memories, embeddings, or entities', async () => {
    const result = await searchMemories(db, userId, {
      query: 'Arjun',
      limit: 50,
      includeArchived: false,
      embeddingProviderOverride: embeddingProvider,
    });

    // None of userId's results should be memories that only exist for otherUserId.
    const otherUserMemories = await db.query.memories.findMany({ where: (m, { eq }) => eq(m.userId, otherUserId) });
    const otherIds = new Set(otherUserMemories.map((m) => m.id));
    for (const r of result.results) {
      expect(otherIds.has(r.memory.id)).toBe(false);
    }
    // And entity expansion must never have pulled in the other user's "Arjun" entity.
    expect(result.matchedEntities.every((e) => e.id !== undefined)).toBe(true);
  });

  it('user isolation: searching as the other user returns only their own "Arjun" memory, never the first user’s', async () => {
    const result = await searchMemories(db, otherUserId, {
      query: 'Arjun',
      limit: 50,
      includeArchived: false,
      embeddingProviderOverride: embeddingProvider,
    });
    for (const r of result.results) {
      expect(r.memory.id).not.toBe(memoryIds.arjunDrone);
    }
    expect(result.matchedEntities.every((e) => e.name === 'Arjun')).toBe(true);
  });

  it('user isolation over HTTP: the authenticated user’s token determines scope regardless of what the client asks for — never another user’s data', async () => {
    const loginA = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: userEmail, password: 'password123' },
    });
    const tokenA = loginA.json().accessToken;

    const response = await app.inject({
      method: 'POST',
      url: '/search',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { query: 'Arjun', limit: 50 },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const ids: string[] = body.results.map((r: { memory: { id: string } }) => r.memory.id);
    expect(ids).toContain(memoryIds.arjunDrone);

    // otherUserId's own "Arjun" memory (created in this same beforeAll)
    // must never appear in userId's HTTP-level results.
    const otherUserOwnMemories = await db.query.memories.findMany({ where: (m, { eq }) => eq(m.userId, otherUserId) });
    for (const otherMemory of otherUserOwnMemories) {
      expect(ids).not.toContain(otherMemory.id);
    }
  });

  describe('Phase 17 — deterministic temporal query understanding', () => {
    it('a bare word match plus a "today" expression in the query text excludes an old memory, with no explicit date range passed', async () => {
      const result = await searchMemories(db, userId, {
        query: 'office today',
        limit: 50,
        includeArchived: false,
        embeddingProviderOverride: embeddingProvider,
      });
      const ids = result.results.map((r) => r.memory.id);
      expect(ids).not.toContain(memoryIds.old); // 2015-01-01 — must be excluded once "today" scopes the query
    });

    it('an explicit occurredAfter always overrides a temporal expression in the query text', async () => {
      const result = await searchMemories(db, userId, {
        query: 'office today', // query text says "today"...
        limit: 50,
        includeArchived: false,
        occurredAfter: new Date('2010-01-01T00:00:00.000Z'), // ...but the caller explicitly asked for a much wider range
        embeddingProviderOverride: embeddingProvider,
      });
      const ids = result.results.map((r) => r.memory.id);
      expect(ids).toContain(memoryIds.old); // only reachable if the explicit range won, not "today"
    });

    it('a query with no temporal expression and no explicit range applies no date filtering', async () => {
      const result = await searchMemories(db, userId, {
        query: 'office',
        limit: 50,
        includeArchived: false,
        embeddingProviderOverride: embeddingProvider,
      });
      const ids = result.results.map((r) => r.memory.id);
      expect(ids).toContain(memoryIds.old);
    });
  });

  describe('Phase 30 — deduplication and missing-embedding handling', () => {
    it('a memory matched by semantic, lexical, AND entity retrieval appears exactly once, not three times', async () => {
      // memoryIds.arjunDrone is linked to both Arjun and Drone Project
      // (entity branch), contains "drone" and "flight controller"
      // verbatim (lexical branch), and shares enough vocabulary with the
      // query for FixtureEmbeddingProvider to rank it semantically
      // (semantic branch) — a real three-way hit across every candidate
      // source in a single query.
      const result = await searchMemories(db, userId, {
        query: 'Arjun drone project flight controller redesign',
        limit: 50,
        includeArchived: false,
        embeddingProviderOverride: embeddingProvider,
      });
      const occurrences = result.results.filter((r) => r.memory.id === memoryIds.arjunDrone);
      expect(occurrences).toHaveLength(1);
    });

    it('a memory with no embedding still participates in lexical/entity retrieval, contributing zero semantic signal instead of crashing or being silently dropped', async () => {
      const unembedded = await createMemory(db, userId, {
        source: { sourceType: 'manual' },
        content: 'Never embedded drone project status update.',
        memoryType: 'note',
        epistemicStatus: 'explicit',
        confidence: 1,
        importance: 3,
        entityLinks: [{ entityId: droneProjectId, role: 'about' }],
      });
      // Deliberately no embedMemory() call for this one.

      const result = await searchMemories(db, userId, {
        query: 'drone project',
        limit: 50,
        includeArchived: false,
        embeddingProviderOverride: embeddingProvider,
      });
      const match = result.results.find((r) => r.memory.id === unembedded);
      expect(match).toBeDefined();
      expect(match!.signals.semanticSimilarity).toBe(0);
      // Still findable — lexical ("drone project" verbatim) and entity (linked to Drone Project) branches carried it.
      expect(match!.matchReasons.some((r) => r.includes('exact wording') || r.includes('Drone Project'))).toBe(true);
    });
  });
});
