import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

/**
 * Authorization and request-validation checks for /search — same
 * pattern as ingestion.validation.test.ts: these never reach the
 * database (vitest.config.ts points DATABASE_URL at an unreachable
 * host on purpose). Fastify runs schema (body) validation before the
 * `authenticate` preHandler, so a malformed body 400s even without a
 * token — matching the existing ingestion/memories validation tests'
 * observed behavior, not an assumption.
 */

describe('POST /search — authorization and validation', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an unauthenticated request with an otherwise-valid body', async () => {
    const response = await app.inject({ method: 'POST', url: '/search', payload: { query: 'Arjun' } });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an empty query', async () => {
    const response = await app.inject({ method: 'POST', url: '/search', payload: { query: '' } });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a missing query field', async () => {
    const response = await app.inject({ method: 'POST', url: '/search', payload: {} });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an extremely long query beyond the 2000-char limit', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/search',
      payload: { query: 'x'.repeat(2001) },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a limit above the allowed maximum', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/search',
      payload: { query: 'test', limit: 500 },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a limit below 1', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/search',
      payload: { query: 'test', limit: 0 },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a malformed occurredAfter date', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/search',
      payload: { query: 'test', occurredAfter: 'not-a-date' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('accepts a query at exactly the length boundary (still 401 for no auth, proving validation passed)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/search',
      payload: { query: 'x'.repeat(2000) },
    });
    expect(response.statusCode).toBe(401);
  });
});
