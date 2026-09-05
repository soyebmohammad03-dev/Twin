import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';

/**
 * Real database-backed tests — creation, retrieval, update, archive,
 * and entity linking, run against `twin_test` (a dedicated database
 * on the same local Postgres container used for development, applied
 * with the same migrations — see infra/init/002-test-database.sql).
 * Nothing here is mocked: every assertion is the real Fastify app
 * talking to a real, disposable Postgres database.
 *
 * vitest.config.ts sets a global (unreachable) DATABASE_URL so
 * memories.validation.test.ts and health.test.ts can assert honest
 * failure without a live DB. This file overrides that with
 * `vi.stubEnv` and only *dynamically* imports app.ts afterward —
 * config/env.ts reads `process.env.DATABASE_URL` at import time, so a
 * static top-level import here would have already captured the fake
 * value before this file's code runs.
 */

const TEST_DATABASE_URL =
  process.env.TWIN_TEST_DATABASE_URL ?? 'postgres://twin:twin_dev_password@localhost:5432/twin_test';

describe('memory and entity routes — real database', () => {
  let app: FastifyInstance;
  let accessToken: string;
  let userId: string;
  const testEmail = `memory-integration-${Date.now()}@twin.test`;

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL);

    const { buildApp } = await import('../src/app.js');
    app = await buildApp();

    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Memory Integration', email: testEmail, password: 'password123' },
    });
    expect(signup.statusCode).toBe(201);
    const body = signup.json();
    accessToken = body.accessToken;
    userId = body.user.id;
  });

  afterAll(async () => {
    // Cleanup cascades through every table via ON DELETE CASCADE.
    await app.db.execute(sql`DELETE FROM users WHERE id = ${userId}`);
    await app.close();
    vi.unstubAllEnvs();
  });

  function authHeader() {
    return { authorization: `Bearer ${accessToken}` };
  }

  it('creates a memory with an inline source', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/memories',
      headers: authHeader(),
      payload: {
        content: 'Sarah prefers async communication.',
        memoryType: 'people',
        epistemicStatus: 'explicit',
        confidence: 1,
        importance: 4,
        source: { sourceType: 'manual', title: 'Test capture' },
      },
    });

    expect(response.statusCode).toBe(201);
    const memory = response.json();
    expect(memory.content).toBe('Sarah prefers async communication.');
    expect(memory.confidence).toBe(1);
    expect(memory.importance).toBe(4);
    expect(memory.source.sourceType).toBe('manual');
    expect(memory.source.title).toBe('Test capture');
    expect(memory.entityLinks).toEqual([]);
  });

  it('creates a memory referencing an existing source', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/memories',
      headers: authHeader(),
      payload: { content: 'first', source: { sourceType: 'voice_note' } },
    });
    const sourceId = first.json().sourceId;

    const second = await app.inject({
      method: 'POST',
      url: '/memories',
      headers: authHeader(),
      payload: { content: 'second, same source', sourceId },
    });

    expect(second.statusCode).toBe(201);
    expect(second.json().sourceId).toBe(sourceId);
  });

  it('rejects a sourceId that does not belong to the user', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/memories',
      headers: authHeader(),
      payload: { content: 'test', sourceId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('lists memories for the authenticated user, newest first', async () => {
    const response = await app.inject({ method: 'GET', url: '/memories', headers: authHeader() });
    expect(response.statusCode).toBe(200);
    const memories = response.json();
    expect(Array.isArray(memories)).toBe(true);
    expect(memories.length).toBeGreaterThanOrEqual(3);
  });

  it('filters the list by memoryType', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/memories?memoryType=people',
      headers: authHeader(),
    });
    expect(response.statusCode).toBe(200);
    const memories = response.json();
    expect(memories.length).toBeGreaterThanOrEqual(1);
    for (const m of memories) {
      expect(m.memoryType).toBe('people');
    }
  });

  it('retrieves a single memory by id', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/memories',
      headers: authHeader(),
      payload: { content: 'detail target', source: { sourceType: 'manual' } },
    });
    const id = created.json().id;

    const detail = await app.inject({ method: 'GET', url: `/memories/${id}`, headers: authHeader() });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().id).toBe(id);
  });

  it('404s for a memory id that does not exist', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/memories/00000000-0000-0000-0000-000000000000',
      headers: authHeader(),
    });
    expect(response.statusCode).toBe(404);
  });

  it('updates a memory', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/memories',
      headers: authHeader(),
      payload: { content: 'before update', importance: 2, source: { sourceType: 'manual' } },
    });
    const id = created.json().id;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/memories/${id}`,
      headers: authHeader(),
      payload: { content: 'after update', importance: 5, confidence: 0.5 },
    });

    expect(updated.statusCode).toBe(200);
    const body = updated.json();
    expect(body.content).toBe('after update');
    expect(body.importance).toBe(5);
    expect(body.confidence).toBe(0.5);
  });

  it('creates an entity, links it to a memory, and the link appears in the memory detail', async () => {
    const memory = await app.inject({
      method: 'POST',
      url: '/memories',
      headers: authHeader(),
      payload: { content: 'linking target', source: { sourceType: 'manual' } },
    });
    const memoryId = memory.json().id;

    const entity = await app.inject({
      method: 'POST',
      url: '/entities',
      headers: authHeader(),
      payload: { entityType: 'person', name: 'Sarah Jenkins', description: 'Lead Engineer' },
    });
    expect(entity.statusCode).toBe(201);
    const entityId = entity.json().id;

    const link = await app.inject({
      method: 'POST',
      url: `/memories/${memoryId}/entities`,
      headers: authHeader(),
      payload: { entityId, role: 'about' },
    });
    expect(link.statusCode).toBe(201);
    expect(link.json().role).toBe('about');

    const detail = await app.inject({ method: 'GET', url: `/memories/${memoryId}`, headers: authHeader() });
    const entityLinks = detail.json().entityLinks;
    expect(entityLinks).toHaveLength(1);
    expect(entityLinks[0].entity.name).toBe('Sarah Jenkins');
    expect(entityLinks[0].role).toBe('about');
  });

  it('creates a memory with entityLinks inline at creation time', async () => {
    const entity = await app.inject({
      method: 'POST',
      url: '/entities',
      headers: authHeader(),
      payload: { entityType: 'project', name: 'Project Helios' },
    });
    const entityId = entity.json().id;

    const memory = await app.inject({
      method: 'POST',
      url: '/memories',
      headers: authHeader(),
      payload: {
        content: 'inline-linked memory',
        source: { sourceType: 'manual' },
        entityLinks: [{ entityId, role: 'about' }],
      },
    });

    expect(memory.statusCode).toBe(201);
    expect(memory.json().entityLinks).toHaveLength(1);
    expect(memory.json().entityLinks[0].entity.id).toBe(entityId);
  });

  it('rejects linking to an entity id that does not exist', async () => {
    const memory = await app.inject({
      method: 'POST',
      url: '/memories',
      headers: authHeader(),
      payload: { content: 'x', source: { sourceType: 'manual' } },
    });
    const memoryId = memory.json().id;

    const response = await app.inject({
      method: 'POST',
      url: `/memories/${memoryId}/entities`,
      headers: authHeader(),
      payload: { entityId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('archives (soft-deletes) a memory: excluded from list, 404 on direct fetch, visible with includeArchived', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/memories',
      headers: authHeader(),
      payload: { content: 'to be archived', source: { sourceType: 'manual' } },
    });
    const id = created.json().id;

    const archived = await app.inject({ method: 'DELETE', url: `/memories/${id}`, headers: authHeader() });
    expect(archived.statusCode).toBe(204);

    const afterArchive = await app.inject({ method: 'GET', url: `/memories/${id}`, headers: authHeader() });
    expect(afterArchive.statusCode).toBe(404);

    const list = await app.inject({ method: 'GET', url: '/memories', headers: authHeader() });
    expect(list.json().some((m: { id: string }) => m.id === id)).toBe(false);

    const listIncludingArchived = await app.inject({
      method: 'GET',
      url: '/memories?includeArchived=true',
      headers: authHeader(),
    });
    expect(listIncludingArchived.json().some((m: { id: string }) => m.id === id)).toBe(true);

    const secondArchive = await app.inject({ method: 'DELETE', url: `/memories/${id}`, headers: authHeader() });
    expect(secondArchive.statusCode).toBe(404);
  });

  it('isolates memories between users — a second user cannot read the first user\'s memory', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/memories',
      headers: authHeader(),
      payload: { content: 'user one only', source: { sourceType: 'manual' } },
    });
    const memoryId = created.json().id;

    const otherEmail = `memory-integration-other-${Date.now()}@twin.test`;
    const otherSignup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Other User', email: otherEmail, password: 'password123' },
    });
    const otherToken = otherSignup.json().accessToken;
    const otherUserId = otherSignup.json().user.id;

    const response = await app.inject({
      method: 'GET',
      url: `/memories/${memoryId}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(response.statusCode).toBe(404);

    await app.db.execute(sql`DELETE FROM users WHERE id = ${otherUserId}`);
  });

  // -------------------------------------------------------------------------
  // Phase 38 — memory correction history: a real, append-only record of
  // content corrections, never lost when a memory is edited.
  // -------------------------------------------------------------------------

  describe('GET /memories/:id/corrections', () => {
    it('a freshly created memory has no correction history yet — an honest empty array, not fabricated', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: authHeader(),
        payload: { content: 'Fresh memory, no corrections yet', source: { sourceType: 'manual' } },
      });
      const id = created.json().id;

      const response = await app.inject({ method: 'GET', url: `/memories/${id}/corrections`, headers: authHeader() });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
    });

    it('a no-op patch (identical content) never creates a correction row', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: authHeader(),
        payload: { content: 'Unchanged content', source: { sourceType: 'manual' } },
      });
      const id = created.json().id;

      await app.inject({
        method: 'PATCH',
        url: `/memories/${id}`,
        headers: authHeader(),
        payload: { content: 'Unchanged content' },
      });

      const response = await app.inject({ method: 'GET', url: `/memories/${id}/corrections`, headers: authHeader() });
      expect(response.json()).toEqual([]);
    });

    it('a patch that changes only non-content fields never creates a correction row', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: authHeader(),
        payload: { content: 'Only metadata will change', importance: 2, source: { sourceType: 'manual' } },
      });
      const id = created.json().id;

      await app.inject({
        method: 'PATCH',
        url: `/memories/${id}`,
        headers: authHeader(),
        payload: { importance: 5, confidence: 0.5 },
      });

      const response = await app.inject({ method: 'GET', url: `/memories/${id}/corrections`, headers: authHeader() });
      expect(response.json()).toEqual([]);
    });

    it('a real content correction writes exactly one accurate row, and the memory itself reflects only the new content', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: authHeader(),
        payload: { content: 'Original fact as first recorded', source: { sourceType: 'manual' } },
      });
      const id = created.json().id;

      const updated = await app.inject({
        method: 'PATCH',
        url: `/memories/${id}`,
        headers: authHeader(),
        payload: { content: 'Corrected fact after user fixed it' },
      });
      expect(updated.json().content).toBe('Corrected fact after user fixed it');

      const response = await app.inject({ method: 'GET', url: `/memories/${id}/corrections`, headers: authHeader() });
      expect(response.statusCode).toBe(200);
      const rows = response.json();
      expect(rows).toHaveLength(1);
      expect(rows[0].previousContent).toBe('Original fact as first recorded');
      expect(rows[0].newContent).toBe('Corrected fact after user fixed it');

      // The original text is preserved in history — never destroyed —
      // even though the memory's own current content no longer shows it.
      const detail = await app.inject({ method: 'GET', url: `/memories/${id}`, headers: authHeader() });
      expect(detail.json().content).toBe('Corrected fact after user fixed it');
    });

    it('multiple real corrections accumulate in chronological (oldest-first) order', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: authHeader(),
        payload: { content: 'v1', source: { sourceType: 'manual' } },
      });
      const id = created.json().id;

      await app.inject({ method: 'PATCH', url: `/memories/${id}`, headers: authHeader(), payload: { content: 'v2' } });
      await app.inject({ method: 'PATCH', url: `/memories/${id}`, headers: authHeader(), payload: { content: 'v3' } });

      const response = await app.inject({ method: 'GET', url: `/memories/${id}/corrections`, headers: authHeader() });
      const rows = response.json();
      expect(rows).toHaveLength(2);
      expect(rows[0].previousContent).toBe('v1');
      expect(rows[0].newContent).toBe('v2');
      expect(rows[1].previousContent).toBe('v2');
      expect(rows[1].newContent).toBe('v3');
      expect(new Date(rows[0].changedAt).getTime()).toBeLessThanOrEqual(new Date(rows[1].changedAt).getTime());
    });

    it('a corrected memory\'s source/provenance and creation timestamp never change — only content and updatedAt do', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: authHeader(),
        payload: { content: 'provenance check', epistemicStatus: 'explicit', source: { sourceType: 'manual', title: 'Original source' } },
      });
      const before = created.json();

      const updated = await app.inject({
        method: 'PATCH',
        url: `/memories/${before.id}`,
        headers: authHeader(),
        payload: { content: 'provenance check, corrected' },
      });
      const after = updated.json();

      expect(after.sourceId).toBe(before.sourceId);
      expect(after.source.title).toBe('Original source');
      expect(after.epistemicStatus).toBe('explicit');
      expect(after.createdAt).toBe(before.createdAt);
    });

    it('correction history survives archiving — the audit trail is never lost when a memory is forgotten', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: authHeader(),
        payload: { content: 'will be archived after correction', source: { sourceType: 'manual' } },
      });
      const id = created.json().id;
      await app.inject({
        method: 'PATCH',
        url: `/memories/${id}`,
        headers: authHeader(),
        payload: { content: 'corrected before archiving' },
      });
      await app.inject({ method: 'DELETE', url: `/memories/${id}`, headers: authHeader() });

      const response = await app.inject({ method: 'GET', url: `/memories/${id}/corrections`, headers: authHeader() });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveLength(1);
    });

    it('returns 404 for a non-existent memory id', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/memories/00000000-0000-0000-0000-000000000000/corrections',
        headers: authHeader(),
      });
      expect(response.statusCode).toBe(404);
    });

    it('rejects an unauthenticated request', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: authHeader(),
        payload: { content: 'auth required', source: { sourceType: 'manual' } },
      });
      const response = await app.inject({ method: 'GET', url: `/memories/${created.json().id}/corrections` });
      expect(response.statusCode).toBe(401);
    });

    it('security: a second user cannot view another user\'s memory correction history, even for an archived memory', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: authHeader(),
        payload: { content: 'private correction history', source: { sourceType: 'manual' } },
      });
      const id = created.json().id;
      await app.inject({ method: 'PATCH', url: `/memories/${id}`, headers: authHeader(), payload: { content: 'corrected' } });

      const otherEmail = `memory-corrections-other-${Date.now()}@twin.test`;
      const otherSignup = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: { fullName: 'Other Corrections User', email: otherEmail, password: 'password123' },
      });
      const otherToken = otherSignup.json().accessToken;
      const otherUserId = otherSignup.json().user.id;

      const response = await app.inject({
        method: 'GET',
        url: `/memories/${id}/corrections`,
        headers: { authorization: `Bearer ${otherToken}` },
      });
      expect(response.statusCode).toBe(404);

      await app.db.execute(sql`DELETE FROM users WHERE id = ${otherUserId}`);
    });

    it('repeated identical rebuild-style patches remain idempotent — re-sending the current content never appends a new row', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: authHeader(),
        payload: { content: 'stable content', source: { sourceType: 'manual' } },
      });
      const id = created.json().id;
      await app.inject({ method: 'PATCH', url: `/memories/${id}`, headers: authHeader(), payload: { content: 'stable content' } });
      await app.inject({ method: 'PATCH', url: `/memories/${id}`, headers: authHeader(), payload: { content: 'stable content' } });

      const response = await app.inject({ method: 'GET', url: `/memories/${id}/corrections`, headers: authHeader() });
      expect(response.json()).toEqual([]);
    });
  });
});
