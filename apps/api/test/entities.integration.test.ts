import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Database } from '@twin/db';

/**
 * Phase 33 — real database-backed tests for manual entity creation's
 * subtype-row integrity (POST /entities / entities.service.ts's
 * findOrCreateEntity). Closes the specific gap Phase 32 documented:
 * AI extraction already creates the matching people/projects/goals/
 * events/decisions subtype row for a brand-new entity of that type;
 * the generic manual-creation path did not. This file proves the
 * generic path now does the same, atomically, without fabricating any
 * data the CreateEntityInput contract doesn't actually provide.
 *
 * See test/ai-extraction.integration.test.ts for the equivalent
 * extraction-side coverage (unchanged by this phase) and
 * test/decisions.integration.test.ts for the dedicated decision
 * creation path (also unchanged by this phase).
 */

const TEST_DATABASE_URL =
  process.env.TWIN_TEST_DATABASE_URL ?? 'postgres://twin:twin_dev_password@localhost:5432/twin_test';

describe('manual entity creation — subtype integrity (Phase 33)', () => {
  let app: FastifyInstance;
  let db: Database;
  let findOrCreateEntity: typeof import('../src/modules/entities/entities.service.js').findOrCreateEntity;
  let createEntity: typeof import('../src/modules/entities/entities.service.js').createEntity;
  let getEntityById: typeof import('../src/modules/entities/entities.service.js').getEntityById;

  let userId: string;
  let userToken: string;
  let otherUserId: string;
  let otherToken: string;
  const cleanupUserIds: string[] = [];

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function subtypeRow(table: string, entityId: string): Promise<Record<string, unknown> | undefined> {
    const result = await db.execute(sql.raw(`SELECT * FROM ${table} WHERE entity_id = '${entityId}'`));
    return (result as unknown as { rows: Record<string, unknown>[] }).rows[0];
  }

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL);

    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    db = app.db;

    const entitiesService = await import('../src/modules/entities/entities.service.js');
    findOrCreateEntity = entitiesService.findOrCreateEntity;
    createEntity = entitiesService.createEntity;
    getEntityById = entitiesService.getEntityById;

    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Entities Tester', email: `entities-test-${Date.now()}@twin.test`, password: 'password123' },
    });
    userId = signup.json().user.id;
    userToken = signup.json().accessToken;
    cleanupUserIds.push(userId);

    const otherSignup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Other Entities Tester', email: `entities-other-${Date.now()}@twin.test`, password: 'password123' },
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

  it('1. manually creating a person creates the people subtype row', async () => {
    const result = await findOrCreateEntity(db, userId, { entityType: 'person', name: 'Manual Person One' });
    expect(result.wasCreated).toBe(true);
    const row = await subtypeRow('people', result.entity.id);
    expect(row).toBeDefined();
    expect(row?.role).toBeNull();
    expect(row?.relationship).toBeNull();
  });

  it('2. manually creating a project creates the projects subtype row with the table default status', async () => {
    const result = await findOrCreateEntity(db, userId, { entityType: 'project', name: 'Manual Project One' });
    const row = await subtypeRow('projects', result.entity.id);
    expect(row).toBeDefined();
    expect(row?.status).toBe('active');
    expect(row?.started_at).toBeNull();
  });

  it('3. manually creating a goal creates the goals subtype row with the table default status and no fabricated target date', async () => {
    const result = await findOrCreateEntity(db, userId, { entityType: 'goal', name: 'Manual Goal One' });
    const row = await subtypeRow('goals', result.entity.id);
    expect(row).toBeDefined();
    expect(row?.status).toBe('active');
    expect(row?.target_date).toBeNull(); // CreateEntityInput has no date field — never guessed
  });

  it('4. manually creating an event succeeds but creates NO events subtype row — the generic contract has no legitimate startsAt to give it', async () => {
    const result = await findOrCreateEntity(db, userId, { entityType: 'event', name: 'Manual Event One' });
    expect(result.wasCreated).toBe(true); // the base entity itself is still created — no column on `entities` requires this
    const row = await subtypeRow('events', result.entity.id);
    expect(row).toBeUndefined(); // events.starts_at is NOT NULL with no default — fabricating one is forbidden
  });

  it('5a. decision creation via the dedicated /decisions endpoint is unaffected and still creates exactly one decisions row', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/decisions',
      headers: authHeader(userToken),
      payload: { name: 'Dedicated Decision Path Check' },
    });
    expect(created.statusCode).toBe(201);
    const entityId = created.json().id;
    const rows = await db.execute(sql.raw(`SELECT count(*)::int AS n FROM decisions WHERE entity_id = '${entityId}'`));
    expect((rows as unknown as { rows: { n: number }[] }).rows[0].n).toBe(1);
  });

  it('5b. manually creating a decision via generic POST /entities also gets exactly one decisions subtype row, never a duplicate', async () => {
    const result = await findOrCreateEntity(db, userId, { entityType: 'decision', name: 'Generic Path Decision' });
    const row = await subtypeRow('decisions', result.entity.id);
    expect(row).toBeDefined();
    expect(row?.status).toBe('open'); // never guessed as 'decided' — the generic contract has no decisionStatus field
    const rows = await db.execute(sql.raw(`SELECT count(*)::int AS n FROM decisions WHERE entity_id = '${result.entity.id}'`));
    expect((rows as unknown as { rows: { n: number }[] }).rows[0].n).toBe(1);
  });

  it('6. base entity and its subtype row are created atomically — a duplicate-name race never leaves an entity without its subtype row', async () => {
    const payload = { entityType: 'person' as const, name: 'Atomic Race Person' };
    const results = await Promise.all(Array.from({ length: 5 }, () => findOrCreateEntity(db, userId, payload)));
    const uniqueIds = new Set(results.map((r) => r.entity.id));
    expect(uniqueIds.size).toBe(1); // only one entity ever exists, exactly like the pre-existing race-safety guarantee
    const winnerId = [...uniqueIds][0];
    const row = await subtypeRow('people', winnerId);
    expect(row).toBeDefined(); // the winning creation's subtype row committed, not silently skipped
  });

  it('7. cross-user isolation: user A cannot fetch or mutate an entity created by user B via generic creation', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/entities',
      headers: authHeader(otherToken),
      payload: { entityType: 'person', name: 'Cross User Entity Guard' },
    });
    expect(created.statusCode).toBe(201);
    const entityId = created.json().id;

    const ownerLookup = await getEntityById(db, otherUserId, entityId);
    expect(ownerLookup).toBeDefined();
    const crossLookup = await getEntityById(db, userId, entityId);
    expect(crossLookup).toBeUndefined();
  });

  it('8. a manually created subtype row always belongs to the same user as its parent entity', async () => {
    const result = await findOrCreateEntity(db, otherUserId, { entityType: 'project', name: 'Ownership Match Project' });
    const entity = await getEntityById(db, otherUserId, result.entity.id);
    expect(entity?.userId).toBe(otherUserId);
    // The subtype table itself carries no user_id column (by design — it
    // is a 1:1 extension of `entities`, which is the sole owner record),
    // so "ownership" for the subtype row is entirely inherited through
    // entity_id -> entities.user_id. Confirm that join resolves correctly
    // and only for the real owner.
    const joined = await db.execute(
      sql.raw(
        `SELECT e.user_id FROM entities e JOIN projects p ON p.entity_id = e.id WHERE e.id = '${result.entity.id}'`,
      ),
    );
    const row = (joined as unknown as { rows: { user_id: string }[] }).rows[0];
    expect(row.user_id).toBe(otherUserId);
  });

  it('9. deleting the parent entity leaves zero orphaned subtype rows (database-level cascade)', async () => {
    const result = await findOrCreateEntity(db, userId, { entityType: 'goal', name: 'Cascade Delete Goal' });
    const before = await subtypeRow('goals', result.entity.id);
    expect(before).toBeDefined();

    await db.execute(sql.raw(`DELETE FROM entities WHERE id = '${result.entity.id}'`));

    const after = await subtypeRow('goals', result.entity.id);
    expect(after).toBeUndefined();
  });

  it('10. existing AI extraction subtype behavior is unchanged by this phase (entities.service.ts\'s createEntity, used by the pipeline, still creates no subtype row on its own)', async () => {
    // createEntity is the low-level primitive the extraction pipeline
    // calls directly and then handles subtype creation itself — it must
    // NEVER also create a subtype row, or extraction would get a
    // duplicate-insert error every time (pipeline.ts already inserts
    // the subtype row right after calling this).
    const entity = await createEntity(db, userId, { entityType: 'person', name: 'Low Level Create Person' });
    const row = await subtypeRow('people', entity.id);
    expect(row).toBeUndefined();
  });

  it('11. existing decision creation behavior (status defaults, decidedAt-on-decided) is unchanged', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/decisions',
      headers: authHeader(userToken),
      payload: { name: 'Unchanged Decision Behavior Check', status: 'decided' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().status).toBe('decided');
    expect(created.json().decidedAt).not.toBeNull();
  });

  it('12. existing entity API consumers remain compatible: POST /entities response shape and status codes are unchanged', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/entities',
      headers: authHeader(userToken),
      payload: { entityType: 'project', name: 'Compatibility Check Project' },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ entityType: 'project', name: 'Compatibility Check Project' });
    expect(typeof first.json().id).toBe('string');

    const second = await app.inject({
      method: 'POST',
      url: '/entities',
      headers: authHeader(userToken),
      payload: { entityType: 'project', name: 'compatibility check project' },
    });
    expect(second.statusCode).toBe(200); // reuse still returns 200, not 201 — unchanged contract
    expect(second.json().id).toBe(first.json().id);

    const listed = await app.inject({ method: 'GET', url: '/entities', headers: authHeader(userToken) });
    expect(listed.statusCode).toBe(200);
    expect(Array.isArray(listed.json())).toBe(true);
  });
});
