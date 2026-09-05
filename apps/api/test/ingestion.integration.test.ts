import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';

/**
 * Real database-backed ingestion tests, run against `twin_test` (see
 * memories.integration.test.ts for why this file uses vi.stubEnv +
 * a dynamic import of app.ts rather than a static one). Nothing here
 * is mocked — every assertion is the real Fastify app, the real
 * heuristic extraction provider, and a real Postgres database.
 *
 * The "real web_link fetch" test makes a genuine outbound HTTP
 * request to https://example.com (IANA's dedicated documentation/
 * testing domain) — it requires network access. Every other test in
 * this file needs no network.
 */

const TEST_DATABASE_URL =
  process.env.TWIN_TEST_DATABASE_URL ?? 'postgres://twin:twin_dev_password@localhost:5432/twin_test';

describe('ingestion routes — real database', () => {
  let app: FastifyInstance;
  let accessToken: string;
  let userId: string;
  const testEmail = `ingestion-integration-${Date.now()}@twin.test`;

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL);

    const { buildApp } = await import('../src/app.js');
    app = await buildApp();

    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Ingestion Integration', email: testEmail, password: 'password123' },
    });
    expect(signup.statusCode).toBe(201);
    const body = signup.json();
    accessToken = body.accessToken;
    userId = body.user.id;
  });

  afterAll(async () => {
    await app.db.execute(sql`DELETE FROM users WHERE id = ${userId}`);
    await app.close();
    vi.unstubAllEnvs();
  });

  function authHeader() {
    return { authorization: `Bearer ${accessToken}` };
  }

  it('ingests text and produces a completed job with a real pending → processing → completed history', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ingestion',
      headers: authHeader(),
      payload: { type: 'text', content: 'Sarah prefers async communication over live calls.' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();

    expect(body.job.status).toBe('completed');
    expect(body.job.inputType).toBe('text');
    expect(body.job.extractionProvider).toBe('heuristic-v1');
    expect(body.job.isDuplicate).toBe(false);
    expect(body.job.resultMemoryId).toBe(body.memory.id);
    expect(body.job.statusHistory.map((entry: { status: string }) => entry.status)).toEqual([
      'pending',
      'processing',
      'completed',
    ]);
    expect(body.job.completedAt).not.toBeNull();

    expect(body.memory.content).toBe('Sarah prefers async communication over live calls.');
    // Explicit content, submitted directly by the user — not fabricated inference.
    expect(body.memory.epistemicStatus).toBe('explicit');
    expect(body.memory.confidence).toBe(1);
    expect(body.memory.source.sourceType).toBe('manual');
  });

  it('GET /ingestion/:id returns the same job + memory after the fact', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/ingestion',
      headers: authHeader(),
      payload: { type: 'text', content: 'A distinct fact to retrieve later.' },
    });
    const jobId = created.json().job.id;

    const fetched = await app.inject({ method: 'GET', url: `/ingestion/${jobId}`, headers: authHeader() });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().job.id).toBe(jobId);
    expect(fetched.json().memory.content).toBe('A distinct fact to retrieve later.');
  });

  it('404s for an ingestion job id that does not exist', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/ingestion/00000000-0000-0000-0000-000000000000',
      headers: authHeader(),
    });
    expect(response.statusCode).toBe(404);
  });

  it('links to an existing entity mentioned by name, and does not invent a new one', async () => {
    const entity = await app.inject({
      method: 'POST',
      url: '/entities',
      headers: authHeader(),
      payload: { entityType: 'person', name: 'Marcus Whitfield' },
    });
    expect(entity.statusCode).toBe(201);

    const ingested = await app.inject({
      method: 'POST',
      url: '/ingestion',
      headers: authHeader(),
      payload: { type: 'text', content: 'Caught up with Marcus Whitfield about the roadmap.' },
    });

    const links = ingested.json().memory.entityLinks;
    expect(links).toHaveLength(1);
    expect(links[0].entity.name).toBe('Marcus Whitfield');
    expect(links[0].role).toBe('mentioned');

    // A name NOT in the text must not be linked, and nothing resembling
    // "Unmentioned Person" should have been auto-created.
    const listAfter = await app.inject({
      method: 'GET',
      url: '/entities?name=Unmentioned',
      headers: authHeader(),
    });
    expect(listAfter.json()).toEqual([]);
  });

  it('detects an exact duplicate and does not create a second memory', async () => {
    const unique = `Duplicate check ${Date.now()} — the sky was a particular shade of orange.`;

    const first = await app.inject({
      method: 'POST',
      url: '/ingestion',
      headers: authHeader(),
      payload: { type: 'text', content: unique },
    });
    expect(first.json().job.isDuplicate).toBe(false);
    const originalMemoryId = first.json().memory.id;

    const second = await app.inject({
      method: 'POST',
      url: '/ingestion',
      headers: authHeader(),
      payload: { type: 'text', content: unique },
    });
    expect(second.json().job.isDuplicate).toBe(true);
    expect(second.json().memory.id).toBe(originalMemoryId);

    // Whitespace/case differences still count as the same content.
    const third = await app.inject({
      method: 'POST',
      url: '/ingestion',
      headers: authHeader(),
      payload: { type: 'text', content: `  ${unique.toUpperCase()}  ` },
    });
    expect(third.json().job.isDuplicate).toBe(true);
    expect(third.json().memory.id).toBe(originalMemoryId);

    const memories = await app.inject({ method: 'GET', url: '/memories', headers: authHeader() });
    const matches = memories
      .json()
      .filter((m: { content: string }) => m.content.toLowerCase() === unique.toLowerCase());
    expect(matches).toHaveLength(1);
  });

  it('lets a caller override the epistemic default (e.g. reported_by_other)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ingestion',
      headers: authHeader(),
      payload: {
        type: 'text',
        content: 'Apparently the Q3 budget got cut, according to Sarah.',
        epistemicStatus: 'reported_by_other',
      },
    });
    expect(response.json().memory.epistemicStatus).toBe('reported_by_other');
  });

  it('web_link: defaults to from_source epistemic status and memoryType research', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ingestion',
      headers: authHeader(),
      payload: { type: 'web_link', url: 'https://example.com' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.job.status).toBe('completed');
    expect(body.memory.source.sourceType).toBe('web_link');
    expect(body.memory.source.url).toBe('https://example.com');
    expect(body.memory.epistemicStatus).toBe('from_source');
    expect(body.memory.memoryType).toBe('research');
    expect(body.memory.content.length).toBeGreaterThan(0);
  });

  it('web_link: a genuinely unreachable host produces a failed job, not a fake success', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ingestion',
      headers: authHeader(),
      payload: { type: 'web_link', url: 'https://this-domain-should-not-exist-twin-test.invalid' },
    });

    expect(response.statusCode).toBe(201); // the job resource was created
    const body = response.json();
    expect(body.job.status).toBe('failed');
    expect(body.job.statusHistory.map((entry: { status: string }) => entry.status)).toEqual([
      'pending',
      'processing',
      'failed',
    ]);
    expect(body.job.errorMessage).toBeTruthy();
    expect(body.job.resultMemoryId).toBeNull();
    expect(body.memory).toBeNull();
  });

  it('web_link: refuses to fetch a private/internal address (SSRF guard)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ingestion',
      headers: authHeader(),
      payload: { type: 'web_link', url: 'http://127.0.0.1:5432' },
    });

    const body = response.json();
    expect(body.job.status).toBe('failed');
    expect(body.job.errorMessage).toMatch(/private|internal|localhost/i);
    expect(body.memory).toBeNull();
  });

  it('image ingestion: requires a manual description (no OCR) and stores it as explicit content', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ingestion',
      headers: authHeader(),
      payload: { type: 'image', description: 'A whiteboard photo of the Q3 architecture diagram.' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.job.status).toBe('completed');
    expect(body.memory.source.sourceType).toBe('image');
    expect(body.memory.epistemicStatus).toBe('explicit');
    expect(body.memory.content).toBe('A whiteboard photo of the Q3 architecture diagram.');
  });

  it('lists jobs for the authenticated user only, filterable by status', async () => {
    const list = await app.inject({ method: 'GET', url: '/ingestion', headers: authHeader() });
    expect(list.statusCode).toBe(200);
    expect(list.json().length).toBeGreaterThan(0);

    const failedOnly = await app.inject({
      method: 'GET',
      url: '/ingestion?status=failed',
      headers: authHeader(),
    });
    for (const job of failedOnly.json()) {
      expect(job.status).toBe('failed');
    }
  });

  it('isolates ingestion jobs between users', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/ingestion',
      headers: authHeader(),
      payload: { type: 'text', content: 'user one only, ingestion isolation check' },
    });
    const jobId = created.json().job.id;

    const otherEmail = `ingestion-other-${Date.now()}@twin.test`;
    const otherSignup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { fullName: 'Other User', email: otherEmail, password: 'password123' },
    });
    const otherToken = otherSignup.json().accessToken;
    const otherUserId = otherSignup.json().user.id;

    const crossRead = await app.inject({
      method: 'GET',
      url: `/ingestion/${jobId}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(crossRead.statusCode).toBe(404);

    const otherList = await app.inject({
      method: 'GET',
      url: '/ingestion',
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(otherList.json()).toEqual([]);

    await app.db.execute(sql`DELETE FROM users WHERE id = ${otherUserId}`);
  });
});
