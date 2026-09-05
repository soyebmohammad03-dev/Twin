import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Database } from '@twin/db';
import { FixtureAIProvider } from '../src/modules/ingestion/ai/fixtureProvider.js';

/**
 * Real database-backed tests for the Phase 5 AI extraction pipeline,
 * run against `twin_test` (see memories.integration.test.ts for why
 * this file uses vi.stubEnv + a dynamic import of app.ts). Every test
 * calls `ingest()` directly (not over HTTP) so it can inject a
 * FixtureAIProvider via `IngestOptions.aiProviderOverride` — a
 * deterministic stand-in for a real model that lets these tests
 * assert exact pipeline behavior (grounding, confidence, entity
 * resolution, failure handling) without depending on network access
 * or real model output. See README notes in the Phase 5 report for
 * what was *additionally* live-verified against the real Gemini API.
 */

const TEST_DATABASE_URL =
  process.env.TWIN_TEST_DATABASE_URL ?? 'postgres://twin:twin_dev_password@localhost:5432/twin_test';

describe('AI extraction pipeline — real database', () => {
  let app: FastifyInstance;
  let db: Database;
  let ingest: typeof import('../src/modules/ingestion/ingestion.service.js').ingest;
  let createEntityRow: (userId: string, type: string, name: string) => Promise<string>;
  let userId: string;
  let cleanupUserIds: string[];

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL);

    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    db = app.db;

    const ingestionService = await import('../src/modules/ingestion/ingestion.service.js');
    ingest = ingestionService.ingest;

    cleanupUserIds = [];

    const signupResult = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'AI Extraction Tester', email: `ai-extraction-${Date.now()}@twin.test`, password: 'password123' },
    });
    expect(signupResult.statusCode).toBe(201);
    userId = signupResult.json().user.id;
    cleanupUserIds.push(userId);

    const { createEntity } = await import('../src/modules/entities/entities.service.js');
    createEntityRow = async (uid, type, name) => {
      const entity = await createEntity(db, uid, { entityType: type as never, name });
      return entity.id;
    };
  });

  afterAll(async () => {
    for (const id of cleanupUserIds) {
      await db.execute(sql`DELETE FROM users WHERE id = ${id}`);
    }
    await app.close();
    vi.unstubAllEnvs();
  });

  function validResponse(overrides: Partial<{ entities: unknown[]; memories: unknown[]; relationships: unknown[] }> = {}) {
    return JSON.stringify({ entities: [], memories: [], relationships: [], ...overrides });
  }

  it('valid extraction: creates a new person entity, links it, and stores a preference memory', async () => {
    const content = 'Caught up with Priya Nair about Project Aurora. She prefers async written updates over calls.';

    const result = await ingest(
      db,
      userId,
      { type: 'text', content },
      {
        aiProviderOverride: new FixtureAIProvider(
          JSON.stringify({
            entities: [
              {
                type: 'person',
                name: 'Priya Nair',
                epistemicStatus: 'explicit',
                confidence: 0.95,
                evidence: 'Caught up with Priya Nair',
              },
              {
                type: 'project',
                name: 'Project Aurora',
                epistemicStatus: 'explicit',
                confidence: 0.9,
                evidence: 'Project Aurora',
              },
            ],
            memories: [
              {
                kind: 'preference',
                content: 'Priya prefers async written updates over calls.',
                epistemicStatus: 'explicit',
                confidence: 0.9,
                importance: 3,
                relatedEntityNames: ['Priya Nair'],
                evidence: 'prefers async written updates over calls',
              },
            ],
            relationships: [
              {
                fromEntityName: 'Priya Nair',
                toEntityName: 'Project Aurora',
                relationshipType: 'works_on',
                epistemicStatus: 'inferred',
                confidence: 0.6,
                evidence: 'Caught up with Priya Nair about Project Aurora',
              },
            ],
          }),
        ),
      },
    );

    const { job, memory } = await result;
    expect(job.status).toBe('completed');
    expect(job.extractionResult).toMatchObject({ status: 'completed', provider: 'fixture-test-provider' });
    expect(memory?.content).toBe(content);
    // Regression check: the returned primary memory must reflect the
    // entity links AI enrichment added, not a stale pre-enrichment
    // snapshot — found via live Gemini testing (memory.entityLinks
    // came back empty despite entities genuinely being linked).
    expect(memory?.entityLinks.map((l) => l.entity.name).sort()).toEqual(['Priya Nair', 'Project Aurora'].sort());

    const audit = job.extractionResult as { storage: { entities: unknown[]; memoryIds: string[]; relationships: unknown[] } };
    expect(audit.storage.entities).toHaveLength(2);
    expect(audit.storage.memoryIds).toHaveLength(1);
    expect(audit.storage.relationships).toHaveLength(1);

    // The new preference memory is real and independently retrievable.
    const extraMemoryId = audit.storage.memoryIds[0];
    const detail = await import('../src/modules/memories/memories.service.js').then((m) =>
      m.getMemoryDetail(db, userId, extraMemoryId),
    );
    expect(detail?.content).toBe('Priya prefers async written updates over calls.');
    expect(detail?.memoryType).toBe('preference');
    expect(detail?.epistemicStatus).toBe('explicit');
    expect(detail?.entityLinks.map((l) => l.entity.name)).toContain('Priya Nair');
  });

  it('malformed AI output: invalid JSON does not fail the job — primary memory still saved, extraction marked failed', async () => {
    const content = 'A note whose AI enrichment will receive garbage back from the model.';

    const { job, memory } = await ingest(
      db,
      userId,
      { type: 'text', content },
      { aiProviderOverride: new FixtureAIProvider('this is not { valid json') },
    );

    expect(job.status).toBe('completed');
    expect(memory).not.toBeNull();
    expect(memory?.content).toBe(content);
    expect(job.extractionResult).toMatchObject({ status: 'failed', provider: 'fixture-test-provider' });
    expect((job.extractionResult as { error: string }).error).toMatch(/JSON/i);
  });

  it('malformed AI output: JSON that violates the schema is treated the same way (fails safely, no corrupted memory)', async () => {
    const content = 'Another note where the model returns structurally invalid data.';

    const { job, memory } = await ingest(
      db,
      userId,
      { type: 'text', content },
      {
        aiProviderOverride: new FixtureAIProvider(
          JSON.stringify({ entities: [{ type: 'not-a-type', name: 123 }] }),
        ),
      },
    );

    expect(job.status).toBe('completed');
    expect(memory).not.toBeNull();
    expect(job.extractionResult).toMatchObject({ status: 'failed' });
  });

  it('hallucination/unsupported claims: an item whose evidence is not in the source is silently dropped, not stored', async () => {
    const content = 'Met with the design team to review the new onboarding flow mockups.';

    const { job } = await ingest(
      db,
      userId,
      { type: 'text', content },
      {
        aiProviderOverride: new FixtureAIProvider(
          JSON.stringify({
            entities: [],
            memories: [
              {
                kind: 'fact',
                content: 'The team decided to delay the launch by two weeks.',
                epistemicStatus: 'inferred',
                confidence: 0.8,
                importance: 3,
                relatedEntityNames: [],
                // Fabricated — never appeared in the source text.
                evidence: 'delay the launch by two weeks',
              },
            ],
            relationships: [],
          }),
        ),
      },
    );

    expect(job.status).toBe('completed');
    const audit = job.extractionResult as { storage: { memoryIds: string[]; dropped: { reason: string }[] } };
    expect(audit.storage.memoryIds).toHaveLength(0);
    expect(audit.storage.dropped.some((d) => d.reason === 'ungrounded_evidence')).toBe(true);
  });

  it('confidence handling: a low-confidence claim is dropped rather than stored as a guess', async () => {
    const content = 'Quick note about a possible reorg mentioned in passing.';

    const { job } = await ingest(
      db,
      userId,
      { type: 'text', content },
      {
        aiProviderOverride: new FixtureAIProvider(
          JSON.stringify({
            entities: [],
            memories: [
              {
                kind: 'fact',
                content: 'There might be a reorg.',
                epistemicStatus: 'probable',
                confidence: 0.1,
                importance: 2,
                relatedEntityNames: [],
                evidence: 'possible reorg mentioned in passing',
              },
            ],
            relationships: [],
          }),
        ),
      },
    );

    const audit = job.extractionResult as { storage: { memoryIds: string[]; dropped: { reason: string }[] } };
    expect(audit.storage.memoryIds).toHaveLength(0);
    expect(audit.storage.dropped[0].reason).toBe('low_confidence');
  });

  it('epistemic status: reported_by_other is preserved through to the stored memory', async () => {
    const content = 'Marcus told me the client pushed the deadline to next quarter.';

    const { job } = await ingest(
      db,
      userId,
      { type: 'text', content },
      {
        aiProviderOverride: new FixtureAIProvider(
          JSON.stringify({
            entities: [],
            memories: [
              {
                kind: 'fact',
                content: 'The client pushed the deadline to next quarter.',
                epistemicStatus: 'reported_by_other',
                confidence: 0.85,
                importance: 3,
                relatedEntityNames: [],
                evidence: 'the client pushed the deadline to next quarter',
              },
            ],
            relationships: [],
          }),
        ),
      },
    );

    const audit = job.extractionResult as { storage: { memoryIds: string[] } };
    const memoryId = audit.storage.memoryIds[0];
    const detail = await import('../src/modules/memories/memories.service.js').then((m) =>
      m.getMemoryDetail(db, userId, memoryId),
    );
    expect(detail?.epistemicStatus).toBe('reported_by_other');
  });

  it('entity resolution: reuses an existing entity by exact name and does not create a duplicate', async () => {
    const existingId = await createEntityRow(userId, 'person', 'Elena Vasquez');
    const content = 'Elena Vasquez approved the budget this morning.';

    const { job } = await ingest(
      db,
      userId,
      { type: 'text', content },
      {
        aiProviderOverride: new FixtureAIProvider(
          JSON.stringify({
            entities: [
              {
                type: 'person',
                name: 'Elena Vasquez',
                epistemicStatus: 'explicit',
                confidence: 0.9,
                evidence: 'Elena Vasquez approved the budget',
              },
            ],
            memories: [],
            relationships: [],
          }),
        ),
      },
    );

    const audit = job.extractionResult as {
      storage: { entities: { entityId: string; resolution: string }[] };
    };
    expect(audit.storage.entities).toHaveLength(1);
    expect(audit.storage.entities[0].resolution).toBe('reused');
    expect(audit.storage.entities[0].entityId).toBe(existingId);
  });

  it('entity resolution: a similarly-named person is never merged with an existing one', async () => {
    await createEntityRow(userId, 'person', 'Jon Ostrander');
    const content = 'Had lunch with John Ostrander to discuss the merger.';

    const { job } = await ingest(
      db,
      userId,
      { type: 'text', content },
      {
        aiProviderOverride: new FixtureAIProvider(
          JSON.stringify({
            entities: [
              {
                type: 'person',
                name: 'John Ostrander',
                epistemicStatus: 'explicit',
                confidence: 0.9,
                evidence: 'lunch with John Ostrander',
              },
            ],
            memories: [],
            relationships: [],
          }),
        ),
      },
    );

    const audit = job.extractionResult as { storage: { entities: { resolution: string; name: string }[] } };
    expect(audit.storage.entities[0].resolution).toBe('created');
    expect(audit.storage.entities[0].name).toBe('John Ostrander');
  });

  it('duplicate information: submitting the same content twice does not duplicate AI-extracted memories either', async () => {
    const unique = `AI dup check ${Date.now()} — Priya confirmed the rollout date.`;
    const provider = () =>
      new FixtureAIProvider(
        JSON.stringify({
          entities: [],
          memories: [
            {
              kind: 'fact',
              content: 'The rollout date is confirmed.',
              epistemicStatus: 'explicit',
              confidence: 0.9,
              importance: 3,
              relatedEntityNames: [],
              evidence: 'confirmed the rollout date',
            },
          ],
          relationships: [],
        }),
      );

    const first = await ingest(db, userId, { type: 'text', content: unique }, { aiProviderOverride: provider() });
    expect(first.job.isDuplicate).toBe(false);

    const second = await ingest(db, userId, { type: 'text', content: unique }, { aiProviderOverride: provider() });
    // Duplicate detection short-circuits before AI extraction ever runs again.
    expect(second.job.isDuplicate).toBe(true);
    expect(second.job.extractionResult).toBeNull();
    expect(second.memory?.id).toBe(first.memory?.id);
  });

  it('provider failure: a rate-limited/timeout AI provider fails safely without corrupting the primary memory', async () => {
    const content = 'Note captured while the AI provider is unavailable.';

    const { job, memory } = await ingest(
      db,
      userId,
      { type: 'text', content },
      { aiProviderOverride: new FixtureAIProvider({ error: 'rate_limited', message: 'Simulated 429 from provider.' }) },
    );

    expect(job.status).toBe('completed');
    expect(memory?.content).toBe(content);
    expect(job.extractionResult).toMatchObject({ status: 'failed' });
    expect((job.extractionResult as { error: string }).error).toMatch(/rate_limited/);
  });

  it('provider failure: a timeout is reported the same way', async () => {
    const content = 'Note captured while the AI provider times out.';

    const { job } = await ingest(
      db,
      userId,
      { type: 'text', content },
      { aiProviderOverride: new FixtureAIProvider({ error: 'timeout', message: 'Simulated timeout.' }) },
    );

    expect(job.extractionResult).toMatchObject({ status: 'failed' });
    expect((job.extractionResult as { error: string }).error).toMatch(/timeout/);
  });

  it('user isolation: AI-extracted entities and memories never leak across users', async () => {
    const otherEmail = `ai-extraction-other-${Date.now()}@twin.test`;
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp();
    const otherSignup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Other User', email: otherEmail, password: 'password123' },
    });
    const otherUserId = otherSignup.json().user.id;
    cleanupUserIds.push(otherUserId);
    await app.close();

    await createEntityRow(userId, 'person', 'Isolation Test Person');

    const { job } = await ingest(
      db,
      otherUserId,
      { type: 'text', content: 'Isolation Test Person joined the call.' },
      {
        aiProviderOverride: new FixtureAIProvider(
          JSON.stringify({
            entities: [
              {
                type: 'person',
                name: 'Isolation Test Person',
                epistemicStatus: 'explicit',
                confidence: 0.9,
                evidence: 'Isolation Test Person joined',
              },
            ],
            memories: [],
            relationships: [],
          }),
        ),
      },
    );

    const audit = job.extractionResult as { storage: { entities: { resolution: string }[] } };
    // otherUserId has no entities of their own — must create, never reuse user one's entity.
    expect(audit.storage.entities[0].resolution).toBe('created');
  });

  it('empty extraction is a valid, honest result — no entities/memories forced into existence', async () => {
    const content = 'Just a short reminder to buy milk.';

    const { job } = await ingest(
      db,
      userId,
      { type: 'text', content },
      { aiProviderOverride: new FixtureAIProvider(validResponse()) },
    );

    expect(job.status).toBe('completed');
    expect(job.extractionResult).toMatchObject({ status: 'completed' });
    const audit = job.extractionResult as { storage: { entities: unknown[]; memoryIds: string[] } };
    expect(audit.storage.entities).toHaveLength(0);
    expect(audit.storage.memoryIds).toHaveLength(0);
  });

  it('when no AI provider is configured, extractionResult stays null (heuristic-only path unchanged)', async () => {
    const content = 'A plain note with no AI provider configured at all.';
    const { job } = await ingest(db, userId, { type: 'text', content }, { aiProviderOverride: null });

    expect(job.status).toBe('completed');
    expect(job.extractionResult).toBeNull();
    expect(job.extractionProvider).toBe('heuristic-v1');
  });

  describe('Phase 31 — temporal extraction (occurredAt persists through the full pipeline)', () => {
    it('an extracted memory with a confidently-stated date stores that exact date as occurredAt, normalized to full ISO-8601', async () => {
      const content = 'The client meeting happened on 2026-03-15 and went well.';
      const { job } = await ingest(
        db,
        userId,
        { type: 'text', content },
        {
          aiProviderOverride: new FixtureAIProvider(
            validResponse({
              memories: [
                {
                  kind: 'event',
                  content: 'The client meeting happened and went well.',
                  epistemicStatus: 'explicit',
                  confidence: 0.9,
                  importance: 3,
                  occurredAt: '2026-03-15',
                  relatedEntityNames: [],
                  evidence: 'client meeting happened on 2026-03-15',
                },
              ],
            }),
          ),
        },
      );

      const audit = job.extractionResult as { storage: { memoryIds: string[] } };
      const { getMemoryDetail } = await import('../src/modules/memories/memories.service.js');
      const detail = await getMemoryDetail(db, userId, audit.storage.memoryIds[0]);
      expect(detail?.occurredAt?.toISOString()).toBe(new Date('2026-03-15').toISOString());
    });

    it('a memory with no stated date leaves occurredAt null rather than inventing one', async () => {
      const content = 'Some context with no date mentioned anywhere.';
      const { job } = await ingest(
        db,
        userId,
        { type: 'text', content },
        {
          aiProviderOverride: new FixtureAIProvider(
            validResponse({
              memories: [
                {
                  kind: 'context',
                  content: 'Some undated context.',
                  epistemicStatus: 'explicit',
                  confidence: 0.9,
                  importance: 2,
                  // no occurredAt
                  relatedEntityNames: [],
                  evidence: 'Some context with no date',
                },
              ],
            }),
          ),
        },
      );

      const audit = job.extractionResult as { storage: { memoryIds: string[] } };
      const { getMemoryDetail } = await import('../src/modules/memories/memories.service.js');
      const detail = await getMemoryDetail(db, userId, audit.storage.memoryIds[0]);
      expect(detail?.occurredAt).toBeNull();
    });
  });

  describe('Phase 31 — decision extraction: finalized vs tentative language', () => {
    async function getDecisionStatus(entityId: string): Promise<{ status: string; decidedAt: unknown } | undefined> {
      const { getDecisionById } = await import('../src/modules/decisions/decisions.service.js');
      const { decision } = await getDecisionById(db, userId, entityId);
      return { status: decision.status, decidedAt: decision.decidedAt };
    }

    it('explicit finalization language ("I decided...") creates a decision entity with status "decided" and a decidedAt timestamp', async () => {
      const content = "I've decided to work remotely next quarter.";
      const { job } = await ingest(
        db,
        userId,
        { type: 'text', content },
        {
          aiProviderOverride: new FixtureAIProvider(
            validResponse({
              entities: [
                {
                  type: 'decision',
                  name: 'Work remotely next quarter',
                  decisionStatus: 'decided',
                  epistemicStatus: 'explicit',
                  confidence: 0.95,
                  evidence: "I've decided to work remotely next quarter",
                },
              ],
            }),
          ),
        },
      );

      const audit = job.extractionResult as { storage: { entities: { entityId: string; resolution: string }[] } };
      expect(audit.storage.entities).toHaveLength(1);
      const status = await getDecisionStatus(audit.storage.entities[0].entityId);
      expect(status?.status).toBe('decided');
      expect(status?.decidedAt).not.toBeNull();
    });

    it('tentative language ("leaning toward...") never finalizes a decision — status stays "open", decidedAt stays null', async () => {
      const content = "I'm leaning toward working remotely next quarter, still weighing it.";
      const { job } = await ingest(
        db,
        userId,
        { type: 'text', content },
        {
          aiProviderOverride: new FixtureAIProvider(
            validResponse({
              entities: [
                {
                  type: 'decision',
                  name: 'Possible remote work next quarter',
                  decisionStatus: 'tentative',
                  epistemicStatus: 'explicit',
                  confidence: 0.8,
                  evidence: "I'm leaning toward working remotely next quarter",
                },
              ],
            }),
          ),
        },
      );

      const audit = job.extractionResult as { storage: { entities: { entityId: string }[] } };
      const status = await getDecisionStatus(audit.storage.entities[0].entityId);
      expect(status?.status).toBe('open');
      expect(status?.decidedAt).toBeNull();
    });

    it('a decision entity with no decisionStatus field at all defaults to "open" — never guesses "decided"', async () => {
      const content = 'Something about a decision, phrased ambiguously.';
      const { job } = await ingest(
        db,
        userId,
        { type: 'text', content },
        {
          aiProviderOverride: new FixtureAIProvider(
            validResponse({
              entities: [
                {
                  type: 'decision',
                  name: 'Ambiguous decision case',
                  // decisionStatus omitted entirely
                  epistemicStatus: 'explicit',
                  confidence: 0.7,
                  evidence: 'Something about a decision',
                },
              ],
            }),
          ),
        },
      );

      const audit = job.extractionResult as { storage: { entities: { entityId: string }[] } };
      const status = await getDecisionStatus(audit.storage.entities[0].entityId);
      expect(status?.status).toBe('open');
    });

    it('re-mentioning an EXISTING decision entity never changes its already-recorded status — extraction only sets status on first creation', async () => {
      const decisionEntityId = await createEntityRow(userId, 'decision', 'Existing Finalized Decision');
      const { getDecisionById } = await import('../src/modules/decisions/decisions.service.js');
      // createEntityRow only makes the bare entity row (matching pre-Phase-31
      // extraction behavior) — insert the decisions subtype row directly so
      // this fixture represents an already-decided decision from before.
      await db.execute(sql`INSERT INTO decisions (entity_id, status, decided_at) VALUES (${decisionEntityId}, 'decided', now())`);

      const content = 'Just checking in on the existing finalized decision again, no change.';
      await ingest(
        db,
        userId,
        { type: 'text', content },
        {
          aiProviderOverride: new FixtureAIProvider(
            validResponse({
              entities: [
                {
                  type: 'decision',
                  name: 'Existing Finalized Decision',
                  decisionStatus: 'tentative', // even if the model got this wrong, reuse must not touch status
                  epistemicStatus: 'explicit',
                  confidence: 0.9,
                  evidence: 'checking in on the existing finalized decision',
                },
              ],
            }),
          ),
        },
      );

      const { decision } = await getDecisionById(db, userId, decisionEntityId);
      expect(decision.status).toBe('decided'); // unchanged — extraction never rewrites an existing decision's status
    });

    it('user isolation: a decision extracted for one user never resolves against another user\'s same-named decision, and stays fetchable only by its owner', async () => {
      const otherEmail = `ai-extraction-decision-other-${Date.now()}@twin.test`;
      const { buildApp } = await import('../src/app.js');
      const app = await buildApp();
      const otherSignup = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: { fullName: 'Other Decision User', email: otherEmail, password: 'password123' },
      });
      const otherUserId = otherSignup.json().user.id;
      cleanupUserIds.push(otherUserId);
      await app.close();

      // userId already has a decided "Existing Finalized Decision" from the
      // previous test — otherUserId extracting the exact same name must
      // create their own separate decision, never reuse or reveal userId's.
      const { job } = await ingest(
        db,
        otherUserId,
        { type: 'text', content: "I've decided on Existing Finalized Decision too." },
        {
          aiProviderOverride: new FixtureAIProvider(
            validResponse({
              entities: [
                {
                  type: 'decision',
                  name: 'Existing Finalized Decision',
                  decisionStatus: 'decided',
                  epistemicStatus: 'explicit',
                  confidence: 0.9,
                  evidence: "I've decided on Existing Finalized Decision",
                },
              ],
            }),
          ),
        },
      );

      const audit = job.extractionResult as { storage: { entities: { entityId: string; resolution: string }[] } };
      expect(audit.storage.entities[0].resolution).toBe('created'); // never reused across users
      const otherEntityId = audit.storage.entities[0].entityId;

      const { getDecisionById, DecisionError } = await import('../src/modules/decisions/decisions.service.js');
      // The new decision is fetchable by its real owner...
      await expect(getDecisionById(db, otherUserId, otherEntityId)).resolves.toBeDefined();
      // ...and 404s (not leaks) when the FIRST user tries to fetch it.
      await expect(getDecisionById(db, userId, otherEntityId)).rejects.toThrow(DecisionError);
    });
  });

  describe('Phase 31 — relationship deduplication across separate captures', () => {
    it('the same relationship extracted from two different captures upserts to one row, not two', async () => {
      const contentA = 'Arjun is now working on the Nebula Rollout project.';
      const responseA = validResponse({
        entities: [
          { type: 'person', name: 'Arjun', epistemicStatus: 'explicit', confidence: 0.9, evidence: 'Arjun is now working' },
          { type: 'project', name: 'Nebula Rollout', epistemicStatus: 'explicit', confidence: 0.9, evidence: 'Nebula Rollout project' },
        ],
        relationships: [
          {
            fromEntityName: 'Arjun',
            toEntityName: 'Nebula Rollout',
            relationshipType: 'works_on',
            epistemicStatus: 'explicit',
            confidence: 0.8,
            evidence: 'Arjun is now working on the Nebula Rollout project',
          },
        ],
      });
      await ingest(db, userId, { type: 'text', content: contentA }, { aiProviderOverride: new FixtureAIProvider(responseA) });

      const contentB = 'Reminder: Arjun still works on the Nebula Rollout project this month too.';
      const responseB = validResponse({
        entities: [
          { type: 'person', name: 'Arjun', epistemicStatus: 'explicit', confidence: 0.9, evidence: 'Arjun still works' },
          { type: 'project', name: 'Nebula Rollout', epistemicStatus: 'explicit', confidence: 0.9, evidence: 'Nebula Rollout project' },
        ],
        relationships: [
          {
            fromEntityName: 'Arjun',
            toEntityName: 'Nebula Rollout',
            relationshipType: 'works_on',
            epistemicStatus: 'explicit',
            confidence: 0.85,
            evidence: 'Arjun still works on the Nebula Rollout project',
          },
        ],
      });
      const { job: jobB } = await ingest(db, userId, { type: 'text', content: contentB }, { aiProviderOverride: new FixtureAIProvider(responseB) });

      const auditB = jobB.extractionResult as { storage: { relationships: { relationshipId: string }[] } };
      expect(auditB.storage.relationships).toHaveLength(1);

      const { listRelationshipsAmongEntities } = await import('../src/modules/graph/relationships.service.js');
      const entitiesAuditB = (jobB.extractionResult as { storage: { entities: { name: string; entityId: string }[] } }).storage
        .entities;
      const arjunId = entitiesAuditB.find((e) => e.name === 'Arjun')!.entityId;
      const nebulaId = entitiesAuditB.find((e) => e.name === 'Nebula Rollout')!.entityId;
      const rels = await listRelationshipsAmongEntities(db, userId, [arjunId, nebulaId]);
      const worksOnRels = rels.filter(
        (r) =>
          r.relationshipType === 'works_on' &&
          ((r.fromEntityId === arjunId && r.toEntityId === nebulaId) || (r.fromEntityId === nebulaId && r.toEntityId === arjunId)),
      );
      expect(worksOnRels).toHaveLength(1); // one upserted row, not two duplicate rows from two captures
    });
  });

  describe('Phase 32 — person, project, goal, event subtype extraction', () => {
    async function subtypeRow(table: string, entityId: string): Promise<Record<string, unknown> | undefined> {
      const result = await db.execute(sql.raw(`SELECT * FROM ${table} WHERE entity_id = '${entityId}'`));
      return (result as unknown as { rows: Record<string, unknown>[] }).rows[0];
    }

    it('a new person entity from real evidence gets both the entities row and a people subtype row', async () => {
      const content = 'My friend Ravi Kapoor is joining our project next week.';
      const { job } = await ingest(
        db,
        userId,
        { type: 'text', content },
        {
          aiProviderOverride: new FixtureAIProvider(
            validResponse({
              entities: [
                {
                  type: 'person',
                  name: 'Ravi Kapoor',
                  epistemicStatus: 'explicit',
                  confidence: 0.9,
                  evidence: 'My friend Ravi Kapoor is joining',
                },
              ],
            }),
          ),
        },
      );

      const audit = job.extractionResult as { storage: { entities: { entityId: string; type: string; resolution: string }[] } };
      expect(audit.storage.entities[0].resolution).toBe('created');
      const row = await subtypeRow('people', audit.storage.entities[0].entityId);
      expect(row).toBeDefined(); // subtype row exists — no fabricated role/relationship/contactInfo beyond table defaults
      expect(row?.role).toBeNull();
      expect(row?.relationship).toBeNull();
    });

    it('a new project entity gets a projects subtype row with the table default status, never a fabricated one', async () => {
      const content = 'Twin is my personal intelligence project.';
      const { job } = await ingest(
        db,
        userId,
        { type: 'text', content },
        {
          aiProviderOverride: new FixtureAIProvider(
            validResponse({
              entities: [
                {
                  type: 'project',
                  name: 'Twin',
                  epistemicStatus: 'explicit',
                  confidence: 0.9,
                  evidence: 'Twin is my personal intelligence project',
                },
              ],
            }),
          ),
        },
      );

      const audit = job.extractionResult as { storage: { entities: { entityId: string }[] } };
      const row = await subtypeRow('projects', audit.storage.entities[0].entityId);
      expect(row).toBeDefined();
      expect(row?.status).toBe('active'); // the table's own default — never guessed by extraction
      expect(row?.started_at).toBeNull();
    });

    it('a goal with a specific, resolvable target date stores it; a vague goal stores no date', async () => {
      const contentA = 'My goal is to launch Twin publicly by 2027-03-01.';
      const { job: jobA } = await ingest(
        db,
        userId,
        { type: 'text', content: contentA },
        {
          aiProviderOverride: new FixtureAIProvider(
            validResponse({
              entities: [
                {
                  type: 'goal',
                  name: 'Launch Twin publicly',
                  targetDate: '2027-03-01',
                  epistemicStatus: 'explicit',
                  confidence: 0.9,
                  evidence: 'My goal is to launch Twin publicly by 2027-03-01',
                },
              ],
            }),
          ),
        },
      );
      const auditA = jobA.extractionResult as { storage: { entities: { entityId: string }[] } };
      const rowA = await subtypeRow('goals', auditA.storage.entities[0].entityId);
      expect(rowA?.status).toBe('active');
      expect(new Date(rowA?.target_date as string).toISOString()).toBe(new Date('2027-03-01').toISOString());

      const contentB = 'My goal is to finish the project before the semester ends.';
      const { job: jobB } = await ingest(
        db,
        userId,
        { type: 'text', content: contentB },
        {
          aiProviderOverride: new FixtureAIProvider(
            validResponse({
              entities: [
                {
                  type: 'goal',
                  name: 'Finish the project before semester ends',
                  // no targetDate — "before the semester ends" is not a resolvable date
                  epistemicStatus: 'explicit',
                  confidence: 0.85,
                  evidence: 'finish the project before the semester ends',
                },
              ],
            }),
          ),
        },
      );
      const auditB = jobB.extractionResult as { storage: { entities: { entityId: string }[] } };
      const rowB = await subtypeRow('goals', auditB.storage.entities[0].entityId);
      expect(rowB?.target_date).toBeNull(); // never approximated from a vague phrase
    });

    it('an event with a confident date gets an events subtype row with that exact startsAt', async () => {
      const content = 'My presentation is on 2026-09-15.';
      const { job } = await ingest(
        db,
        userId,
        { type: 'text', content },
        {
          aiProviderOverride: new FixtureAIProvider(
            validResponse({
              entities: [
                {
                  type: 'event',
                  name: 'Presentation',
                  startsAt: '2026-09-15',
                  epistemicStatus: 'explicit',
                  confidence: 0.9,
                  evidence: 'My presentation is on 2026-09-15',
                },
              ],
            }),
          ),
        },
      );

      const audit = job.extractionResult as { storage: { entities: { entityId: string }[] } };
      expect(audit.storage.entities).toHaveLength(1); // never dropped — a confident date was supplied
      const row = await subtypeRow('events', audit.storage.entities[0].entityId);
      expect(row).toBeDefined();
      expect(new Date(row?.starts_at as string).toISOString()).toBe(new Date('2026-09-15').toISOString());
      expect(row?.end_at ?? row?.ends_at).toBeFalsy();
    });

    it('an event entity with no confident date is dropped before it ever reaches subtype storage (pre-existing Phase 6 guard, still intact)', async () => {
      const content = 'The exam is next Monday, not sure exactly when yet.';
      const { job } = await ingest(
        db,
        userId,
        { type: 'text', content },
        {
          aiProviderOverride: new FixtureAIProvider(
            validResponse({
              entities: [
                {
                  type: 'event',
                  name: 'Exam',
                  // no startsAt — "next Monday" is not something the model resolved to a real date here
                  epistemicStatus: 'explicit',
                  confidence: 0.7,
                  evidence: 'The exam is next Monday',
                },
              ],
            }),
          ),
        },
      );

      const audit = job.extractionResult as { storage: { entities: unknown[]; dropped: { kind: string; reason: string }[] } };
      expect(audit.storage.entities).toHaveLength(0);
      expect(audit.storage.dropped[0]).toMatchObject({ kind: 'entity', reason: 'invalid_event_no_date' });
    });

    it('a casual wish/possibility never becomes a goal — the extraction contract\'s job to classify it, but a "goal" entity still requires the same grounding as any other', async () => {
      // This asserts the SAFETY NET, not the model's own judgment (which
      // cannot be live-tested — see report): even if something slipped
      // through as a "goal" type with insufficient confidence, the
      // existing confidence floor still drops it rather than storing it.
      const content = 'Maybe I will work with Arjun on something someday.';
      const { job } = await ingest(
        db,
        userId,
        { type: 'text', content },
        {
          aiProviderOverride: new FixtureAIProvider(
            validResponse({
              entities: [
                {
                  type: 'goal',
                  name: 'Work with Arjun someday',
                  epistemicStatus: 'probable',
                  confidence: 0.2, // correctly low — the model recognizing this is only a maybe
                  evidence: 'Maybe I will work with Arjun on something someday',
                },
              ],
            }),
          ),
        },
      );

      const audit = job.extractionResult as { storage: { entities: unknown[] }; storage: { dropped: { reason: string }[] } };
      expect(audit.storage.entities).toHaveLength(0);
      expect(audit.storage.dropped[0].reason).toBe('low_confidence');
    });

    it('re-mentioning an EXISTING person/project/goal/event never creates or modifies its subtype row — only first creation does', async () => {
      const projectEntityId = await createEntityRow(userId, 'project', 'Existing Bare Project');
      // createEntityRow (like pre-Phase-32 extraction) only makes the bare
      // entities row — confirming a project that predates this phase has
      // no subtype row, and reuse must not retroactively create one.
      const before = await subtypeRow('projects', projectEntityId);
      expect(before).toBeUndefined();

      const { job } = await ingest(
        db,
        userId,
        { type: 'text', content: 'Quick update on Existing Bare Project, still going.' },
        {
          aiProviderOverride: new FixtureAIProvider(
            validResponse({
              entities: [
                {
                  type: 'project',
                  name: 'Existing Bare Project',
                  epistemicStatus: 'explicit',
                  confidence: 0.9,
                  evidence: 'update on Existing Bare Project',
                },
              ],
            }),
          ),
        },
      );

      const audit = job.extractionResult as { storage: { entities: { resolution: string; entityId: string }[] } };
      expect(audit.storage.entities[0].resolution).toBe('reused');
      const after = await subtypeRow('projects', projectEntityId);
      expect(after).toBeUndefined(); // reuse never backfills a subtype row that didn't already exist
    });

    it('a person -> works_on -> project relationship extracted alongside both new entities is stored with real evidence', async () => {
      const content = 'Elina now works on the MarketMatrix project full time.';
      const { job } = await ingest(
        db,
        userId,
        { type: 'text', content },
        {
          aiProviderOverride: new FixtureAIProvider(
            validResponse({
              entities: [
                { type: 'person', name: 'Elina', epistemicStatus: 'explicit', confidence: 0.9, evidence: 'Elina now works on' },
                {
                  type: 'project',
                  name: 'MarketMatrix',
                  epistemicStatus: 'explicit',
                  confidence: 0.9,
                  evidence: 'MarketMatrix project',
                },
              ],
              relationships: [
                {
                  fromEntityName: 'Elina',
                  toEntityName: 'MarketMatrix',
                  relationshipType: 'works_on',
                  epistemicStatus: 'explicit',
                  confidence: 0.85,
                  evidence: 'Elina now works on the MarketMatrix project',
                },
              ],
            }),
          ),
        },
      );

      const audit = job.extractionResult as { storage: { relationships: { relationshipType: string }[] } };
      expect(audit.storage.relationships).toHaveLength(1);
      expect(audit.storage.relationships[0].relationshipType).toBe('works_on');
    });

    it('user isolation: a person/project/goal/event created for one user never resolves against another user\'s same-named entity, and their subtype rows stay private', async () => {
      const otherEmail = `ai-extraction-p32-other-${Date.now()}@twin.test`;
      const { buildApp } = await import('../src/app.js');
      const app = await buildApp();
      const otherSignup = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: { fullName: 'Other P32 User', email: otherEmail, password: 'password123' },
      });
      const otherUserId = otherSignup.json().user.id;
      cleanupUserIds.push(otherUserId);
      await app.close();

      await createEntityRow(userId, 'person', 'Cross User Person');

      const { job } = await ingest(
        db,
        otherUserId,
        { type: 'text', content: 'Cross User Person joined our call today.' },
        {
          aiProviderOverride: new FixtureAIProvider(
            validResponse({
              entities: [
                {
                  type: 'person',
                  name: 'Cross User Person',
                  epistemicStatus: 'explicit',
                  confidence: 0.9,
                  evidence: 'Cross User Person joined our call',
                },
              ],
            }),
          ),
        },
      );

      const audit = job.extractionResult as { storage: { entities: { resolution: string; entityId: string }[] } };
      expect(audit.storage.entities[0].resolution).toBe('created'); // never reused across users
      const row = await subtypeRow('people', audit.storage.entities[0].entityId);
      expect(row).toBeDefined();

      // The new person's subtype row belongs only to otherUserId's entity —
      // querying it via the FIRST user's id must not resolve it at all.
      const { getEntityById } = await import('../src/modules/entities/entities.service.js');
      const otherEntity = await getEntityById(db, otherUserId, audit.storage.entities[0].entityId);
      const crossOwnerLookup = await getEntityById(db, userId, audit.storage.entities[0].entityId);
      expect(otherEntity).toBeDefined();
      expect(crossOwnerLookup).toBeUndefined();
    });
  });
});
