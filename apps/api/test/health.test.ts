import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports liveness without touching the database', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(typeof body.timestamp).toBe('string');
  });
});

describe('GET /health/db', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports a real error when Postgres is unreachable, never a fake ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/db' });

    // vitest.config.ts points DATABASE_URL at a host with nothing
    // listening, so this must fail honestly.
    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.status).toBe('error');
    expect(typeof body.message).toBe('string');
  });
});
