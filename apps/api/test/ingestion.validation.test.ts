import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

/**
 * Authorization and request-validation checks for /ingestion — same
 * pattern as memories.validation.test.ts: these never reach the
 * database (vitest.config.ts points DATABASE_URL at an unreachable
 * host on purpose), because auth and body validation both happen
 * before any route handler touches app.db.
 */

describe('ingestion routes — authorization and validation', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects POST /ingestion without a token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ingestion',
      payload: { type: 'text', content: 'test' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects GET /ingestion without a token', async () => {
    const response = await app.inject({ method: 'GET', url: '/ingestion' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects GET /ingestion/:id without a token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/ingestion/00000000-0000-0000-0000-000000000000',
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an unknown input type', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ingestion',
      payload: { type: 'carrier_pigeon', content: 'test' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects text ingestion with empty content', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ingestion',
      payload: { type: 'text', content: '' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects voice_transcript with no transcript field', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ingestion',
      payload: { type: 'voice_transcript' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects web_link with an invalid URL', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ingestion',
      payload: { type: 'web_link', url: 'not-a-url' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects web_link with no url field', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ingestion',
      payload: { type: 'web_link' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects image ingestion with no description (no OCR — a description is required)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ingestion',
      payload: { type: 'image' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects document ingestion with no description (no document parsing — a description is required)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ingestion',
      payload: { type: 'document' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an out-of-range importance override', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ingestion',
      payload: { type: 'text', content: 'test', importance: 9 },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an invalid epistemicStatus override', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ingestion',
      payload: { type: 'text', content: 'test', epistemicStatus: 'made_up_value' },
    });
    expect(response.statusCode).toBe(400);
  });
});
