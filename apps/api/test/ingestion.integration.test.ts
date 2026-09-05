import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import PDFDocument from 'pdfkit';

/**
 * Builds a real, valid PDF buffer via pdfkit — used only to produce a
 * real document for extractPdfText/documentExtract.ts to parse; the
 * test never hand-crafts or fakes extracted text itself.
 */
function makePdfBuffer(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.text(text);
    doc.end();
  });
}

/** Hand-built multipart/form-data body — app.inject() doesn't have a built-in multipart helper. */
function buildMultipartBody(
  fields: Record<string, string>,
  file?: { fieldName: string; filename: string; contentType: string; data: Buffer },
): { body: Buffer; contentType: string } {
  const boundary = `----twin-test-boundary-${Date.now()}`;
  const parts: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      ),
      file.data,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

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

  it('Phase 42: ingests a voice transcript end-to-end — real memory, correct provenance, retrievable via Context Engine', async () => {
    const marker = `voice-marker-${Date.now()}`;
    const response = await app.inject({
      method: 'POST',
      url: '/ingestion',
      headers: authHeader(),
      payload: { type: 'voice_transcript', transcript: `Reminder to follow up with the vendor. ${marker}` },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.job.status).toBe('completed');
    expect(body.job.inputType).toBe('voice_transcript');
    expect(body.memory.content).toBe(`Reminder to follow up with the vendor. ${marker}`);
    // The transcript is the user's own words (STT already happened upstream), never downgraded to inferred.
    expect(body.memory.epistemicStatus).toBe('explicit');
    expect(body.memory.source.sourceType).toBe('voice_note');
    expect(body.memory.source.rawContent).toBe(`Reminder to follow up with the vendor. ${marker}`);

    const contextResponse = await app.inject({
      method: 'POST',
      url: '/context',
      headers: authHeader(),
      payload: { query: marker },
    });
    expect(contextResponse.statusCode).toBe(200);
    expect(contextResponse.json().memories.some((m: { memoryId: string }) => m.memoryId === body.memory.id)).toBe(true);
  });

  it('Phase 42: a duplicate voice transcript is detected the same way as any other input type', async () => {
    const transcript = `Duplicate voice transcript check ${Date.now()}`;
    const first = await app.inject({ method: 'POST', url: '/ingestion', headers: authHeader(), payload: { type: 'voice_transcript', transcript } });
    const second = await app.inject({ method: 'POST', url: '/ingestion', headers: authHeader(), payload: { type: 'voice_transcript', transcript } });
    expect(second.json().job.isDuplicate).toBe(true);
    expect(second.json().memory.id).toBe(first.json().memory.id);
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

  // -------------------------------------------------------------------------
  // Phase 42 — real PDF document ingestion (POST /ingestion/documents)
  // -------------------------------------------------------------------------

  describe('POST /ingestion/documents — real PDF text extraction', () => {
    it('extracts real text from an uploaded PDF and stores it as a from_source document memory', async () => {
      const marker = `pdf-marker-${Date.now()}`;
      const pdfText = `This is a real Twin test document. ${marker} appears here as genuine extracted content.`;
      const pdf = await makePdfBuffer(pdfText);
      const { body, contentType } = buildMultipartBody(
        {},
        { fieldName: 'file', filename: 'test.pdf', contentType: 'application/pdf', data: pdf },
      );

      const response = await app.inject({
        method: 'POST',
        url: '/ingestion/documents',
        headers: { ...authHeader(), 'content-type': contentType },
        payload: body,
      });

      expect(response.statusCode).toBe(201);
      const result = response.json();
      expect(result.job.status).toBe('completed');
      expect(result.memory.source.sourceType).toBe('document');
      expect(result.memory.epistemicStatus).toBe('from_source');
      expect(result.memory.content).toContain(marker);
      expect(result.memory.source.rawContent).toContain(marker);
      expect(result.memory.source.title).toBe('test.pdf');
    });

    it('an optional title field overrides the filename', async () => {
      const pdf = await makePdfBuffer('Titled document content for the override test.');
      const { body, contentType } = buildMultipartBody(
        { title: 'My Custom Document Title' },
        { fieldName: 'file', filename: 'ignored.pdf', contentType: 'application/pdf', data: pdf },
      );

      const response = await app.inject({
        method: 'POST',
        url: '/ingestion/documents',
        headers: { ...authHeader(), 'content-type': contentType },
        payload: body,
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().memory.source.title).toBe('My Custom Document Title');
    });

    it('duplicate detection: uploading the same document content twice never creates a second memory', async () => {
      const pdf = await makePdfBuffer(`Duplicate document check ${Date.now()}.`);
      const { body: body1, contentType: ct1 } = buildMultipartBody(
        {},
        { fieldName: 'file', filename: 'first.pdf', contentType: 'application/pdf', data: pdf },
      );
      const first = await app.inject({ method: 'POST', url: '/ingestion/documents', headers: { ...authHeader(), 'content-type': ct1 }, payload: body1 });
      expect(first.statusCode).toBe(201);
      const firstMemoryId = first.json().memory.id;

      const { body: body2, contentType: ct2 } = buildMultipartBody(
        {},
        { fieldName: 'file', filename: 'second.pdf', contentType: 'application/pdf', data: pdf },
      );
      const second = await app.inject({ method: 'POST', url: '/ingestion/documents', headers: { ...authHeader(), 'content-type': ct2 }, payload: body2 });
      expect(second.statusCode).toBe(201);
      const secondResult = second.json();
      expect(secondResult.job.isDuplicate).toBe(true);
      expect(secondResult.memory.id).toBe(firstMemoryId);
    });

    it('rejects a non-PDF file with an honest 415, never fabricating extracted text', async () => {
      const { body, contentType } = buildMultipartBody(
        {},
        { fieldName: 'file', filename: 'note.txt', contentType: 'text/plain', data: Buffer.from('plain text file') },
      );
      const response = await app.inject({
        method: 'POST',
        url: '/ingestion/documents',
        headers: { ...authHeader(), 'content-type': contentType },
        payload: body,
      });
      expect(response.statusCode).toBe(415);
      expect(response.json().error).toBe('unsupported_modality');
    });

    it('rejects a request with no file, honestly, rather than creating an empty memory', async () => {
      const { body, contentType } = buildMultipartBody({ title: 'no file here' });
      const response = await app.inject({
        method: 'POST',
        url: '/ingestion/documents',
        headers: { ...authHeader(), 'content-type': contentType },
        payload: body,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('no_file');
    });

    it('a malformed/corrupt PDF fails honestly with extraction_failed, never a fabricated memory', async () => {
      const { body, contentType } = buildMultipartBody(
        {},
        { fieldName: 'file', filename: 'corrupt.pdf', contentType: 'application/pdf', data: Buffer.from('%PDF-1.4 not a real pdf body at all') },
      );
      const response = await app.inject({
        method: 'POST',
        url: '/ingestion/documents',
        headers: { ...authHeader(), 'content-type': contentType },
        payload: body,
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error).toBe('extraction_failed');
    });

    it('a real extracted document memory is retrievable via Context Engine (end-to-end multimodal retrieval)', async () => {
      const marker = `context-pdf-marker-${Date.now()}`;
      const pdf = await makePdfBuffer(`Twin roadmap notes. ${marker} is the unique topic discussed in this document.`);
      const { body, contentType } = buildMultipartBody(
        {},
        { fieldName: 'file', filename: 'roadmap.pdf', contentType: 'application/pdf', data: pdf },
      );
      const uploadResponse = await app.inject({
        method: 'POST',
        url: '/ingestion/documents',
        headers: { ...authHeader(), 'content-type': contentType },
        payload: body,
      });
      expect(uploadResponse.statusCode).toBe(201);
      const memoryId = uploadResponse.json().memory.id;

      const contextResponse = await app.inject({
        method: 'POST',
        url: '/context',
        headers: authHeader(),
        payload: { query: marker },
      });
      expect(contextResponse.statusCode).toBe(200);
      expect(contextResponse.json().memories.some((m: { memoryId: string }) => m.memoryId === memoryId)).toBe(true);
    });

    it('security: unauthenticated document upload is rejected', async () => {
      const pdf = await makePdfBuffer('unauthenticated upload attempt');
      const { body, contentType } = buildMultipartBody(
        {},
        { fieldName: 'file', filename: 'x.pdf', contentType: 'application/pdf', data: pdf },
      );
      const response = await app.inject({ method: 'POST', url: '/ingestion/documents', headers: { 'content-type': contentType }, payload: body });
      expect(response.statusCode).toBe(401);
    });

    it('cross-user isolation: another user cannot fetch this user\'s document-derived ingestion job', async () => {
      const pdf = await makePdfBuffer('private document content for isolation check');
      const { body, contentType } = buildMultipartBody(
        {},
        { fieldName: 'file', filename: 'private.pdf', contentType: 'application/pdf', data: pdf },
      );
      const uploadResponse = await app.inject({
        method: 'POST',
        url: '/ingestion/documents',
        headers: { ...authHeader(), 'content-type': contentType },
        payload: body,
      });
      const jobId = uploadResponse.json().job.id;

      const otherEmail = `ingestion-doc-other-${Date.now()}@twin.test`;
      const otherSignup = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: { fullName: 'Other Document User', email: otherEmail, password: 'password123' },
      });
      const otherToken = otherSignup.json().accessToken;
      const otherUserId = otherSignup.json().user.id;

      const response = await app.inject({
        method: 'GET',
        url: `/ingestion/${jobId}`,
        headers: { authorization: `Bearer ${otherToken}` },
      });
      expect(response.statusCode).toBe(404);

      await app.db.execute(sql`DELETE FROM users WHERE id = ${otherUserId}`);
    });
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
