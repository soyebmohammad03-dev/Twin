import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

/**
 * Authorization and request-validation checks. These never reach the
 * database — vitest.config.ts points DATABASE_URL at an unreachable
 * host on purpose (same as health.test.ts) — auth and body validation
 * both happen in Fastify's preHandler/validation phase, before any
 * route handler touches app.db. Real DB-backed behavior (creation,
 * retrieval, update, archive, entity linking) is covered separately
 * in memories.integration.test.ts against a real test database.
 */

describe('memory and entity routes — authorization and validation', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects GET /memories without a token', async () => {
    const response = await app.inject({ method: 'GET', url: '/memories' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects POST /memories without a token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/memories',
      payload: { content: 'test', source: { sourceType: 'manual' } },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects GET /memories/:id without a token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/memories/00000000-0000-0000-0000-000000000000',
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects PATCH /memories/:id without a token', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/memories/00000000-0000-0000-0000-000000000000',
      payload: { importance: 5 },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects DELETE /memories/:id without a token', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/memories/00000000-0000-0000-0000-000000000000',
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects POST /memories/:id/entities without a token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/memories/00000000-0000-0000-0000-000000000000/entities',
      payload: { entityId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects POST /entities without a token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/entities',
      payload: { entityType: 'person', name: 'Someone' },
    });
    expect(response.statusCode).toBe(401);
  });

  // An invalid/expired token still fails the JWT verification step
  // before any handler or DB query runs, so this is a validation-layer
  // check too, not a live-DB one.
  it('rejects requests with a garbage bearer token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/memories',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(response.statusCode).toBe(401);
  });

  // Body-schema validation runs before the auth preHandler in
  // Fastify's request lifecycle, so these fail with 400 regardless of
  // whether a token is present — confirmed by omitting one here.
  it('rejects a memory body missing content', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/memories',
      payload: { source: { sourceType: 'manual' } },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a memory body with neither sourceId nor source', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/memories',
      payload: { content: 'test' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a memory body with both sourceId and source', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/memories',
      payload: {
        content: 'test',
        sourceId: '00000000-0000-0000-0000-000000000000',
        source: { sourceType: 'manual' },
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an out-of-range importance value', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/memories',
      payload: { content: 'test', source: { sourceType: 'manual' }, importance: 9 },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an update body with no fields', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/memories/00000000-0000-0000-0000-000000000000',
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });
});
