import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Database } from '@twin/db';
import { entityRelationships } from '@twin/db';

/**
 * Phase 39 — a small, deterministic retrieval evaluation dataset.
 *
 * Rather than re-testing individual retrieval mechanisms already
 * covered by retrieval.search.integration.test.ts and
 * context.integration.test.ts (semantic ranking, bounded graph
 * expansion, archived exclusion, cross-user isolation, determinism —
 * all independently verified there), this file evaluates the FULL
 * Context Engine seam (buildContext) end-to-end against a realistic
 * synthetic dataset and a set of realistic personal-intelligence
 * queries, checking that the expected memory/entity ids actually show
 * up in the assembled ContextPacket. This is the "does retrieval
 * actually answer real questions correctly" check the unit-level
 * tests can't express on their own.
 *
 * No real user data is used — everything below is synthetic, created
 * and torn down by this file alone.
 */

const TEST_DATABASE_URL =
  process.env.TWIN_TEST_DATABASE_URL ?? 'postgres://twin:twin_dev_password@localhost:5432/twin_test';

describe('Phase 39 — retrieval evaluation dataset', () => {
  let app: FastifyInstance;
  let db: Database;
  let buildContext: typeof import('../src/modules/context/contextEngine.js').buildContext;
  let createEntity: typeof import('../src/modules/entities/entities.service.js').createEntity;
  let createMemory: typeof import('../src/modules/memories/memories.service.js').createMemory;
  let createDecision: typeof import('../src/modules/decisions/decisions.service.js').createDecision;
  let updateDecision: typeof import('../src/modules/decisions/decisions.service.js').updateDecision;

  let userId: string;
  let otherUserId: string;
  const cleanupUserIds: string[] = [];
  const suffix = `${Date.now()}`;
  const label = (s: string) => `${s} ${suffix}`;

  // Fixture graph: Priya --[works_on]--> Orion Launch --[resulted_in]--> Cloud Migration (decision)
  let priyaId: string;
  let orionLaunchId: string;
  let cloudMigrationId: string;

  let oldOrionMemoryId: string; // last calendar month
  let recentOrionMemoryId: string; // today
  let priyaMemoryId: string;
  let cloudMigrationMemoryId: string;
  let unrelatedMemoryId: string;

  function daysAgoIso(n: number): string {
    return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
  }

  /** A date guaranteed to fall in the previous CALENDAR month, matching temporalExpressions.ts's "last month" rule exactly (not a rolling 30-day window). */
  function someDateLastCalendarMonth(): string {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12, 0, 0);
    return lastMonth.toISOString();
  }

  async function makeMemory(opts: { uid: string; content: string; entityIds?: string[]; occurredAt?: string; importance?: number }): Promise<string> {
    return createMemory(db, opts.uid, {
      source: { sourceType: 'manual' },
      content: opts.content,
      memoryType: 'note',
      epistemicStatus: 'explicit',
      confidence: 1,
      importance: opts.importance ?? 3,
      occurredAt: opts.occurredAt,
      entityLinks: opts.entityIds?.map((entityId) => ({ entityId, role: 'mentioned' })),
    });
  }

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL);
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    db = app.db;

    ({ buildContext } = await import('../src/modules/context/contextEngine.js'));
    ({ createEntity } = await import('../src/modules/entities/entities.service.js'));
    ({ createMemory } = await import('../src/modules/memories/memories.service.js'));
    ({ createDecision, updateDecision } = await import('../src/modules/decisions/decisions.service.js'));

    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Evaluation Tester', email: `retrieval-eval-${suffix}@twin.test`, password: 'password123' },
    });
    userId = signup.json().user.id;
    cleanupUserIds.push(userId);

    const otherSignup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Other Evaluation User', email: `retrieval-eval-other-${suffix}@twin.test`, password: 'password123' },
    });
    otherUserId = otherSignup.json().user.id;
    cleanupUserIds.push(otherUserId);

    // --- Fixture graph for userId ---
    const priya = await createEntity(db, userId, { entityType: 'person', name: label('Priya') });
    const orionLaunch = await createEntity(db, userId, { entityType: 'project', name: label('Orion Launch') });
    priyaId = priya.id;
    orionLaunchId = orionLaunch.id;

    const { entity: cloudMigration } = await createDecision(db, userId, { name: label('Cloud Migration') });
    cloudMigrationId = cloudMigration.id;

    await db.insert(entityRelationships).values([
      {
        userId,
        fromEntityId: priyaId,
        toEntityId: orionLaunchId,
        relationshipType: 'works_on',
        epistemicStatus: 'explicit',
        extractionMethod: 'test-fixture',
      },
      {
        userId,
        fromEntityId: orionLaunchId,
        toEntityId: cloudMigrationId,
        relationshipType: 'resulted_in',
        epistemicStatus: 'explicit',
        extractionMethod: 'test-fixture',
      },
    ]);

    // A real decision evolution (Phase 36/37): open -> decided -> reversed.
    await updateDecision(db, userId, cloudMigrationId, { status: 'decided', outcome: label('Chose managed cloud provider') });
    await updateDecision(db, userId, cloudMigrationId, { status: 'reversed' });

    oldOrionMemoryId = await makeMemory({
      uid: userId,
      content: label('Kicked off Orion Launch project planning'),
      entityIds: [orionLaunchId],
      occurredAt: someDateLastCalendarMonth(),
    });
    recentOrionMemoryId = await makeMemory({
      uid: userId,
      content: label('Orion Launch is currently in active development, on track for release'),
      entityIds: [orionLaunchId],
      occurredAt: daysAgoIso(0),
      importance: 5,
    });
    priyaMemoryId = await makeMemory({
      uid: userId,
      content: label('Priya took over as lead for the Orion Launch effort'),
      entityIds: [priyaId, orionLaunchId],
      occurredAt: daysAgoIso(3),
    });
    cloudMigrationMemoryId = await makeMemory({
      uid: userId,
      content: label('Decided to reverse the Cloud Migration after cost review'),
      entityIds: [cloudMigrationId],
      occurredAt: daysAgoIso(1),
    });
    unrelatedMemoryId = await makeMemory({
      uid: userId,
      content: label('Bought groceries and cleaned the apartment this weekend'),
      occurredAt: daysAgoIso(2),
    });

    // --- Same-named fixtures for the other user, to prove zero leakage ---
    const otherPriya = await createEntity(db, otherUserId, { entityType: 'person', name: label('Priya') });
    await makeMemory({
      uid: otherUserId,
      content: label('Priya took over as lead for the Orion Launch effort'),
      entityIds: [otherPriya.id],
      occurredAt: daysAgoIso(3),
    });
  });

  afterAll(async () => {
    for (const id of cleanupUserIds) {
      await db.execute(sql`DELETE FROM users WHERE id = ${id}`);
    }
    await app.close();
    vi.unstubAllEnvs();
  });

  it('"What am I currently working on?" surfaces the recent, high-importance Orion Launch memory, not the unrelated one', async () => {
    const packet = await buildContext(db, userId, { query: `What am I currently working on with ${label('Orion Launch')}?` });
    const ids = packet.memories.map((m) => m.memoryId);
    expect(ids).toContain(recentOrionMemoryId);
    expect(ids).not.toContain(unrelatedMemoryId);
    expect(packet.entities.some((e) => e.entityId === orionLaunchId)).toBe(true);
  });

  it('"What do I know about Priya?" surfaces memories connected to Priya, and the Priya entity is a direct match', async () => {
    const packet = await buildContext(db, userId, { query: `What do I know about ${label('Priya')}?` });
    expect(packet.entities.some((e) => e.entityId === priyaId && e.matchType === 'direct')).toBe(true);
    expect(packet.memories.map((m) => m.memoryId)).toContain(priyaMemoryId);
  });

  it('"Why did I choose Cloud Migration?" (explicit decisionEntityId) resolves the decision as an explicit target and includes its evidence memory', async () => {
    const packet = await buildContext(db, userId, {
      query: 'Why did I make this choice?',
      decisionEntityId: cloudMigrationId,
    });
    expect(packet.entities.some((e) => e.entityId === cloudMigrationId && e.matchType === 'target')).toBe(true);
    expect(packet.memories.map((m) => m.memoryId)).toContain(cloudMigrationMemoryId);
  });

  it('"What did I say about Orion Launch last month?" restricts results to last calendar month — excludes the recent memory', async () => {
    const packet = await buildContext(db, userId, { query: `What did I say about ${label('Orion Launch')} last month?` });
    const ids = packet.memories.map((m) => m.memoryId);
    expect(ids).toContain(oldOrionMemoryId);
    expect(ids).not.toContain(recentOrionMemoryId);
    expect(packet.intentSignals.some((s) => s.includes('last month'))).toBe(true);
  });

  it('an unrelated query about groceries does not surface Orion Launch or Priya evidence', async () => {
    const packet = await buildContext(db, userId, { query: 'groceries apartment weekend' });
    const ids = packet.memories.map((m) => m.memoryId);
    expect(ids).toContain(unrelatedMemoryId);
    expect(ids).not.toContain(oldOrionMemoryId);
    expect(ids).not.toContain(priyaMemoryId);
  });

  it('repeated identical queries produce identical, deterministic ordering', async () => {
    const first = await buildContext(db, userId, { query: `${label('Orion Launch')} status` });
    const second = await buildContext(db, userId, { query: `${label('Orion Launch')} status` });
    expect(first.memories.map((m) => m.memoryId)).toEqual(second.memories.map((m) => m.memoryId));
    expect(first.entities.map((e) => e.entityId)).toEqual(second.entities.map((e) => e.entityId));
  });

  it('a query with no matching data returns an honest empty/near-empty packet, never fabricated entries', async () => {
    const packet = await buildContext(db, userId, { query: `completely unrelated nonexistent topic xyzzy-${suffix}` });
    expect(packet.memories.length).toBe(0);
    expect(packet.entities.length).toBe(0);
  });

  it('cross-user isolation: the same entity name ("Priya") and near-identical memory text in another account never leak into this user\'s packet', async () => {
    const packet = await buildContext(db, userId, { query: `What do I know about ${label('Priya')}?` });
    // Every entity id in the packet must belong to userId's own fixture set.
    const allowedEntityIds = new Set([priyaId, orionLaunchId, cloudMigrationId]);
    for (const e of packet.entities) {
      expect(allowedEntityIds.has(e.entityId)).toBe(true);
    }
    // Every memory id must be one of this user's own fixtures.
    const allowedMemoryIds = new Set([oldOrionMemoryId, recentOrionMemoryId, priyaMemoryId, cloudMigrationMemoryId, unrelatedMemoryId]);
    for (const m of packet.memories) {
      expect(allowedMemoryIds.has(m.memoryId)).toBe(true);
    }
  });

  it('cross-user isolation: the other user\'s own context for "Priya" only ever contains their own data', async () => {
    const packet = await buildContext(db, otherUserId, { query: `What do I know about ${label('Priya')}?` });
    for (const m of packet.memories) {
      expect([oldOrionMemoryId, recentOrionMemoryId, priyaMemoryId, cloudMigrationMemoryId, unrelatedMemoryId]).not.toContain(m.memoryId);
    }
  });

  it('every returned memory item carries a traceable, non-fabricated evidence id that resolves back to a real stored memory', async () => {
    const packet = await buildContext(db, userId, { query: `${label('Orion Launch')} Priya` });
    for (const item of packet.memories) {
      const result = await db.execute(sql`SELECT id FROM memories WHERE id = ${item.memoryId} AND user_id = ${userId}`);
      const rows = (result as unknown as { rows: unknown[] }).rows;
      expect(rows.length).toBe(1);
    }
  });
});
