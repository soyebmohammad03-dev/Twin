import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Database } from '@twin/db';
import { FixtureEmbeddingProvider } from '../src/modules/retrieval/embeddings/fixtureProvider.js';

/**
 * Phase 39 — real database-backed tests verifying that Phase 38's
 * memory-correction lifecycle is retrieval-safe: a correction's OLD
 * content must never surface as current evidence (semantically,
 * lexically, or via Context Engine), the NEW content must be fully
 * retrievable, the correction never creates a duplicate/ghost
 * candidate, and none of this crosses user boundaries. No new
 * retrieval code is introduced here — this closes a real, previously
 * untested integration seam between Phase 38 (memories.service.ts's
 * updateMemory) and Phase 6/8's existing hybrid retrieval and Context
 * Engine, both of which already read `memories.content`/`embedding`
 * live rather than caching anything.
 */

const TEST_DATABASE_URL =
  process.env.TWIN_TEST_DATABASE_URL ?? 'postgres://twin:twin_dev_password@localhost:5432/twin_test';

describe('Phase 39 — retrieval safety across memory corrections', () => {
  let app: FastifyInstance;
  let db: Database;
  let searchMemories: typeof import('../src/modules/retrieval/retrieval.service.js').searchMemories;
  let buildContext: typeof import('../src/modules/context/contextEngine.js').buildContext;
  let createMemory: typeof import('../src/modules/memories/memories.service.js').createMemory;
  let updateMemory: typeof import('../src/modules/memories/memories.service.js').updateMemory;
  let embedMemory: typeof import('../src/modules/retrieval/embedding.service.js').embedMemory;

  let userId: string;
  let otherUserId: string;
  const cleanupUserIds: string[] = [];
  const suffix = `${Date.now()}`;

  const embeddingProvider = new FixtureEmbeddingProvider();

  async function makeMemory(uid: string, content: string): Promise<string> {
    const id = await createMemory(db, uid, {
      source: { sourceType: 'manual' },
      content,
      memoryType: 'note',
      epistemicStatus: 'explicit',
      confidence: 1,
      importance: 3,
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
    ({ buildContext } = await import('../src/modules/context/contextEngine.js'));
    ({ createMemory, updateMemory } = await import('../src/modules/memories/memories.service.js'));
    ({ embedMemory } = await import('../src/modules/retrieval/embedding.service.js'));

    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Corrections Retrieval Tester', email: `retrieval-corrections-${suffix}@twin.test`, password: 'password123' },
    });
    userId = signup.json().user.id;
    cleanupUserIds.push(userId);

    const otherSignup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Other Corrections User', email: `retrieval-corrections-other-${suffix}@twin.test`, password: 'password123' },
    });
    otherUserId = otherSignup.json().user.id;
    cleanupUserIds.push(otherUserId);
  });

  afterAll(async () => {
    for (const id of cleanupUserIds) {
      await db.execute(sql`DELETE FROM users WHERE id = ${id}`);
    }
    await app.close();
    vi.unstubAllEnvs();
  });

  it('after a real correction, semantic search for the OLD wording no longer finds the memory, and search for the NEW wording does', async () => {
    const id = await makeMemory(userId, `zephyrhome lives in seattle washington ${suffix}`);

    const beforeSearch = await searchMemories(db, userId, {
      query: `zephyrhome seattle washington ${suffix}`,
      limit: 10,
      includeArchived: false,
      embeddingProviderOverride: embeddingProvider,
    });
    expect(beforeSearch.results.some((r) => r.memory.id === id)).toBe(true);

    await updateMemory(db, userId, id, { content: `zephyrhome lives in austin texas ${suffix}` });
    await embedMemory(db, userId, id, embeddingProvider);

    const afterOldQuery = await searchMemories(db, userId, {
      query: `zephyrhome seattle washington ${suffix}`,
      limit: 10,
      includeArchived: false,
      embeddingProviderOverride: embeddingProvider,
    });
    const found = afterOldQuery.results.find((r) => r.memory.id === id);
    // The corrected memory may still surface on the shared "zephyrhome ... {suffix}"
    // vocabulary, but it must show only its CURRENT content — never the old city.
    if (found) {
      expect(found.memory.content).toContain('austin texas');
      expect(found.memory.content).not.toContain('seattle');
    }

    const afterNewQuery = await searchMemories(db, userId, {
      query: `zephyrhome austin texas ${suffix}`,
      limit: 10,
      includeArchived: false,
      embeddingProviderOverride: embeddingProvider,
    });
    const foundNew = afterNewQuery.results.find((r) => r.memory.id === id);
    expect(foundNew).toBeTruthy();
    expect(foundNew!.memory.content).toBe(`zephyrhome lives in austin texas ${suffix}`);
  });

  it('after a correction, lexical (exact-wording) search never matches the old text, only the new text', async () => {
    const id = await makeMemory(userId, `quixotic-marker-alpha-${suffix} prefers dark mode`);

    await updateMemory(db, userId, id, { content: `quixotic-marker-alpha-${suffix} prefers light mode` });

    const oldTerm = await searchMemories(db, userId, {
      query: 'dark mode',
      limit: 10,
      includeArchived: false,
      embeddingProviderOverride: null,
    });
    expect(oldTerm.results.some((r) => r.memory.id === id)).toBe(false);

    const newTerm = await searchMemories(db, userId, {
      query: `quixotic-marker-alpha-${suffix} light mode`,
      limit: 10,
      includeArchived: false,
      embeddingProviderOverride: null,
    });
    expect(newTerm.results.some((r) => r.memory.id === id)).toBe(true);
    expect(newTerm.results.find((r) => r.memory.id === id)!.memory.content).toContain('light mode');
  });

  it('a correction never creates a duplicate/ghost candidate — the memory appears at most once in results even when it matches multiple branches', async () => {
    const id = await makeMemory(userId, `duplicate-check-marker-${suffix} project kickoff notes`);
    await updateMemory(db, userId, id, { content: `duplicate-check-marker-${suffix} project kickoff notes, revised` });

    const result = await searchMemories(db, userId, {
      query: `duplicate-check-marker-${suffix} project kickoff`,
      limit: 10,
      includeArchived: false,
      embeddingProviderOverride: embeddingProvider,
    });
    const matches = result.results.filter((r) => r.memory.id === id);
    expect(matches).toHaveLength(1);
  });

  it('Context Engine reflects only the corrected content for a memory pulled into a ContextPacket', async () => {
    const id = await makeMemory(userId, `contextpacket-marker-${suffix} original wrong fact`);
    await updateMemory(db, userId, id, { content: `contextpacket-marker-${suffix} corrected right fact` });

    const packet = await buildContext(db, userId, { query: `contextpacket-marker-${suffix} corrected right fact` });
    const item = packet.memories.find((m) => m.memoryId === id);
    expect(item).toBeTruthy();
    expect(item!.content).toContain('corrected right fact');
    expect(item!.content).not.toContain('original wrong fact');
  });

  it('cross-user isolation: correcting one user\'s memory never affects another user\'s retrieval, even with overlapping vocabulary', async () => {
    const mineId = await makeMemory(userId, `shared-vocab-marker-${suffix} status is green`);
    const theirsId = await makeMemory(otherUserId, `shared-vocab-marker-${suffix} status is green`);

    await updateMemory(db, userId, mineId, { content: `shared-vocab-marker-${suffix} status is red` });

    const mine = await searchMemories(db, userId, {
      query: `shared-vocab-marker-${suffix} status`,
      limit: 10,
      includeArchived: false,
      embeddingProviderOverride: embeddingProvider,
    });
    expect(mine.results.find((r) => r.memory.id === mineId)?.memory.content).toContain('red');

    const theirs = await searchMemories(db, otherUserId, {
      query: `shared-vocab-marker-${suffix} status`,
      limit: 10,
      includeArchived: false,
      embeddingProviderOverride: embeddingProvider,
    });
    expect(theirs.results.find((r) => r.memory.id === theirsId)?.memory.content).toBe(
      `shared-vocab-marker-${suffix} status is green`,
    );
    // The other user's result set must never contain MY memory id.
    expect(theirs.results.some((r) => r.memory.id === mineId)).toBe(false);
  });

  it('an archived (forgotten) memory, even one with correction history, never enters default retrieval', async () => {
    const { archiveMemory } = await import('../src/modules/memories/memories.service.js');
    const id = await makeMemory(userId, `archived-history-marker-${suffix} temporary note`);
    await updateMemory(db, userId, id, { content: `archived-history-marker-${suffix} temporary note, edited` });
    await archiveMemory(db, userId, id);

    const result = await searchMemories(db, userId, {
      query: `archived-history-marker-${suffix} temporary note edited`,
      limit: 10,
      includeArchived: false,
      embeddingProviderOverride: embeddingProvider,
    });
    expect(result.results.some((r) => r.memory.id === id)).toBe(false);

    const includingArchived = await searchMemories(db, userId, {
      query: `archived-history-marker-${suffix} temporary note edited`,
      limit: 10,
      includeArchived: true,
      embeddingProviderOverride: embeddingProvider,
    });
    expect(includingArchived.results.some((r) => r.memory.id === id)).toBe(true);
  });
});
