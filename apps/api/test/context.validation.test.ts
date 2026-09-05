import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

/**
 * Authorization and request-validation checks for POST /context — same
 * pattern as retrieval.validation.test.ts: these never reach the
 * database (vitest.config.ts points DATABASE_URL at an unreachable
 * host by default). Fastify validates the body before the
 * `authenticate` preHandler runs, so a malformed body 400s even
 * without a token.
 */

describe('POST /context — authorization and validation', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an unauthenticated request with an otherwise-valid body', async () => {
    const response = await app.inject({ method: 'POST', url: '/context', payload: { query: 'Arjun' } });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an empty query', async () => {
    const response = await app.inject({ method: 'POST', url: '/context', payload: { query: '' } });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a missing query field', async () => {
    const response = await app.inject({ method: 'POST', url: '/context', payload: {} });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an extremely long query beyond the 2000-char limit', async () => {
    const response = await app.inject({ method: 'POST', url: '/context', payload: { query: 'x'.repeat(2001) } });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a non-uuid targetEntityId', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/context',
      payload: { query: 'Arjun', targetEntityId: 'not-a-uuid' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a malformed (out-of-range) budget value', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/context',
      payload: { query: 'Arjun', budget: { maxMemories: 0 } },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a budget value above the allowed maximum', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/context',
      payload: { query: 'Arjun', budget: { maxRelationships: 1000 } },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an invalid graphHops value', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/context',
      payload: { query: 'Arjun', graphHops: 3 },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a malformed occurredAfter that is not an ISO datetime', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/context',
      payload: { query: 'Arjun', occurredAfter: 'not-a-date' },
    });
    expect(response.statusCode).toBe(400);
  });
});
