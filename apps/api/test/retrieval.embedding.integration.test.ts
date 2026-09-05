import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Database } from '@twin/db';
import { FixtureEmbeddingProvider } from '../src/modules/retrieval/embeddings/fixtureProvider.js';
import { EmbeddingProviderError, type EmbeddingProvider } from '../src/modules/retrieval/embeddings/types.js';

/**
 * Real database-backed tests for the Phase 6 embedding pipeline
 * (embedMemory), run against `twin_test`. Every test injects a
 * FixtureEmbeddingProvider (or a small failure-simulating provider
 * below) via embedMemory's providerOverride parameter — deterministic,
 * no network access, no real Gemini calls. See retrieval.search.integration.test.ts
 * for the hybrid search pipeline built on top of this.
 */

const TEST_DATABASE_URL =
  process.env.TWIN_TEST_DATABASE_URL ?? 'postgres://twin:twin_dev_password@localhost:5432/twin_test';

/** Fails every call with a fixed EmbeddingProviderError — for testing embedMemory's failure-safety guarantees. */
class FailingEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'failing-test-provider';
  readonly dimensions = 1536;
  constructor(private readonly code: 'timeout' | 'rate_limited' | 'network' = 'timeout') {}
  async embed(): Promise<never> {
    throw new EmbeddingProviderError(`Simulated ${this.code}.`, this.code);
  }
}

/** Returns a vector with the wrong length — for testing dimension validation. */
class WrongDimensionEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'wrong-dimension-test-provider';
  readonly dimensions = 1536;
  async embed() {
    return { values: new Array(384).fill(0.1), dimensions: 384 };
  }
}

/** Counts calls, delegating to a real FixtureEmbeddingProvider — for asserting idempotency actually skips the provider call. */
class CountingEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly dimensions = 1536;
  callCount = 0;
  private readonly inner = new FixtureEmbeddingProvider();
  constructor(name = 'fixture-test-embeddings') {
    this.name = name;
  }
  async embed(text: string) {
    this.callCount++;
    return this.inner.embed(text);
  }
}

/** db.execute() returns a pg QueryResult ({ rows: [...] }), not a bare array — this pulls the first row for the single-row lookups below. */
async function queryOne<T = Record<string, unknown>>(db: Database, query: ReturnType<typeof sql>): Promise<T> {
  const result = await db.execute(query);
  return (result as unknown as { rows: T[] }).rows[0];
}

describe('embedMemory — real database', () => {
  let app: FastifyInstance;
  let db: Database;
  let embedMemory: typeof import('../src/modules/retrieval/embedding.service.js').embedMemory;
  let createMemory: typeof import('../src/modules/memories/memories.service.js').createMemory;
  let updateMemory: typeof import('../src/modules/memories/memories.service.js').updateMemory;
  let userId: string;
  let otherUserId: string;
  const cleanupUserIds: string[] = [];

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL);

    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    db = app.db;

    ({ embedMemory } = await import('../src/modules/retrieval/embedding.service.js'));
    ({ createMemory, updateMemory } = await import('../src/modules/memories/memories.service.js'));

    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Embedding Tester', email: `embedding-test-${Date.now()}@twin.test`, password: 'password123' },
    });
    userId = signup.json().user.id;
    cleanupUserIds.push(userId);

    const otherSignup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Other User', email: `embedding-other-${Date.now()}@twin.test`, password: 'password123' },
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

  it('embeds a memory and stores model + timestamp + content hash', async () => {
    const memoryId = await makeMemory(userId, 'The drone project uses a custom flight controller.');
    const result = await embedMemory(db, userId, memoryId, new FixtureEmbeddingProvider());

    expect(result.status).toBe('embedded');
    expect(result.provider).toBe('fixture-test-embeddings');

    const row = await queryOne(db, sql`SELECT embedding_model, embedding_generated_at, embedding_content_hash, embedding IS NOT NULL AS has_embedding FROM memories WHERE id = ${memoryId}`);
    expect(row.embedding_model).toBe('fixture-test-embeddings');
    expect(row.embedding_generated_at).not.toBeNull();
    expect(row.embedding_content_hash).not.toBeNull();
    expect(row.has_embedding).toBe(true);
  });

  it('is idempotent: re-embedding an up-to-date memory with the same provider skips the provider call entirely', async () => {
    const memoryId = await makeMemory(userId, 'Idempotency check memory content.');
    const provider = new CountingEmbeddingProvider();

    const first = await embedMemory(db, userId, memoryId, provider);
    expect(first.status).toBe('embedded');
    expect(provider.callCount).toBe(1);

    const second = await embedMemory(db, userId, memoryId, provider);
    expect(second.status).toBe('skipped_up_to_date');
    expect(provider.callCount).toBe(1); // unchanged — no second network/provider call
  });

  it('re-embeds when the configured model/provider name changes', async () => {
    const memoryId = await makeMemory(userId, 'Model-change re-embedding check.');
    await embedMemory(db, userId, memoryId, new CountingEmbeddingProvider('provider-v1'));

    const providerV2 = new CountingEmbeddingProvider('provider-v2');
    const result = await embedMemory(db, userId, memoryId, providerV2);
    expect(result.status).toBe('embedded');
    expect(providerV2.callCount).toBe(1);
  });

  it('skips with skipped_no_provider when no embedding provider is configured', async () => {
    const memoryId = await makeMemory(userId, 'No provider configured for this one.');
    const result = await embedMemory(db, userId, memoryId, null);
    expect(result.status).toBe('skipped_no_provider');
  });

  it('provider failure (timeout) never overwrites a previously-valid embedding', async () => {
    const memoryId = await makeMemory(userId, 'Valid embedding that must survive a later failure.');
    await embedMemory(db, userId, memoryId, new FixtureEmbeddingProvider());

    const before = await queryOne(db, sql`SELECT embedding_model, embedding_generated_at FROM memories WHERE id = ${memoryId}`);

    // A failure with a *different* provider name would otherwise look
    // "stale" by the idempotency check and attempt to re-embed — this
    // simulates exactly that scenario failing.
    const failing = new FailingEmbeddingProvider('timeout');
    const result = await embedMemory(db, userId, memoryId, failing);
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/timeout/);

    const after = await queryOne(db, sql`SELECT embedding_model, embedding_generated_at FROM memories WHERE id = ${memoryId}`);
    expect(after.embedding_model).toBe(before.embedding_model);
    expect(after.embedding_generated_at).toEqual(before.embedding_generated_at);
  });

  it('rate-limit failure is reported distinctly and safely', async () => {
    const memoryId = await makeMemory(userId, 'Rate limited case.');
    const result = await embedMemory(db, userId, memoryId, new FailingEmbeddingProvider('rate_limited'));
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/rate_limited/);
  });

  it('network failure is reported distinctly and safely', async () => {
    const memoryId = await makeMemory(userId, 'Network failure case.');
    const result = await embedMemory(db, userId, memoryId, new FailingEmbeddingProvider('network'));
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/network/);
  });

  it('rejects a wrong-dimension response before it ever reaches the database', async () => {
    const memoryId = await makeMemory(userId, 'Wrong dimension case.');
    const result = await embedMemory(db, userId, memoryId, new WrongDimensionEmbeddingProvider());
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/dimension/i);

    const row = await queryOne(db, sql`SELECT embedding IS NOT NULL AS has_embedding FROM memories WHERE id = ${memoryId}`);
    expect(row.has_embedding).toBe(false);
  });

  it('duplicate/concurrent embed requests for the same memory do not corrupt it', async () => {
    const memoryId = await makeMemory(userId, 'Concurrent embedding requests.');
    const provider = new FixtureEmbeddingProvider();

    const [a, b] = await Promise.all([
      embedMemory(db, userId, memoryId, provider),
      embedMemory(db, userId, memoryId, provider),
    ]);
    expect(['embedded', 'skipped_up_to_date']).toContain(a.status);
    expect(['embedded', 'skipped_up_to_date']).toContain(b.status);

    const row = await queryOne(db, sql`SELECT embedding IS NOT NULL AS has_embedding FROM memories WHERE id = ${memoryId}`);
    expect(row.has_embedding).toBe(true);
  });

  it('user isolation: cannot embed a memory belonging to another user', async () => {
    const otherMemoryId = await makeMemory(otherUserId, 'Belongs to the other user.');
    await expect(embedMemory(db, userId, otherMemoryId, new FixtureEmbeddingProvider())).rejects.toThrow(/not found/i);
  });

  it('Phase 30: updating a memory\'s content invalidates its embedding, so the next embedMemory call re-embeds instead of skipping', async () => {
    const memoryId = await makeMemory(userId, 'Original content before the update.');
    const provider = new CountingEmbeddingProvider();

    const first = await embedMemory(db, userId, memoryId, provider);
    expect(first.status).toBe('embedded');
    expect(provider.callCount).toBe(1);

    // Same content, same provider — must still skip (this is the
    // pre-existing idempotency guarantee; re-asserted here so the
    // update path below is provably the thing that changes it).
    const upToDate = await embedMemory(db, userId, memoryId, provider);
    expect(upToDate.status).toBe('skipped_up_to_date');
    expect(provider.callCount).toBe(1);

    await updateMemory(db, userId, memoryId, { content: 'Completely different content after the update.' });

    const afterUpdate = await embedMemory(db, userId, memoryId, provider);
    expect(afterUpdate.status).toBe('embedded');
    expect(provider.callCount).toBe(2);

    // And the new embedding is stable again until content changes once more.
    const stableAgain = await embedMemory(db, userId, memoryId, provider);
    expect(stableAgain.status).toBe('skipped_up_to_date');
    expect(provider.callCount).toBe(2);
  });

  it('Phase 30: a metadata-only update (no content change) does not invalidate the embedding', async () => {
    const memoryId = await makeMemory(userId, 'Content that never changes.');
    const provider = new CountingEmbeddingProvider();
    await embedMemory(db, userId, memoryId, provider);
    expect(provider.callCount).toBe(1);

    await updateMemory(db, userId, memoryId, { importance: 5 });

    const result = await embedMemory(db, userId, memoryId, provider);
    expect(result.status).toBe('skipped_up_to_date');
    expect(provider.callCount).toBe(1);
  });
});
