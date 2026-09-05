import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';

/**
 * Phase 44 — real database-backed security/hardening tests for the
 * auth surface: brute-force throttling on the credential-bearing
 * endpoints, honest handling of malformed/missing authentication, and
 * logout/session invalidation. Every assertion below is the real
 * Fastify app talking to the real `twin_test` database — nothing is
 * mocked, matching every other integration test in this suite.
 */

const TEST_DATABASE_URL =
  process.env.TWIN_TEST_DATABASE_URL ?? 'postgres://twin:twin_dev_password@localhost:5432/twin_test';

describe('Phase 44 — auth security hardening', () => {
  let app: FastifyInstance;
  const cleanupEmails: string[] = [];

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL);
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
  });

  afterAll(async () => {
    for (const email of cleanupEmails) {
      await app.db.execute(sql`DELETE FROM users WHERE email = ${email}`);
    }
    await app.close();
    vi.unstubAllEnvs();
  });

  // These tests deliberately exhaust the per-IP rate-limit budget, so
  // they run against their OWN app instance (and therefore their own
  // in-memory rate-limit store) — never the shared `app` every other
  // describe block in this file uses, which would otherwise start
  // failing real (unrelated) signup/login calls for the rest of the
  // file once the budget was used up here.
  describe('rate limiting on credential-bearing endpoints', () => {
    let rateLimitApp: FastifyInstance;
    let rateLimitEmails: string[];

    // A fresh app (and therefore a fresh in-memory rate-limit store)
    // per test — each test below deliberately exhausts its own budget,
    // which must never bleed into a sibling test in this same describe.
    beforeEach(async () => {
      const { buildApp } = await import('../src/app.js');
      rateLimitApp = await buildApp();
      rateLimitEmails = [];
    });

    afterEach(async () => {
      for (const email of rateLimitEmails) {
        await rateLimitApp.db.execute(sql`DELETE FROM users WHERE email = ${email}`);
      }
      await rateLimitApp.close();
    });

    it('POST /auth/signup: after the per-IP limit, further attempts get an honest 429, not silently dropped or hung', async () => {
      const suffix = Date.now();
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) {
        const email = `ratelimit-signup-${suffix}-${i}@twin.test`;
        const response = await rateLimitApp.inject({
          method: 'POST',
          url: '/auth/signup',
          payload: { fullName: 'Rate Limit Test', email, password: 'password123' },
        });
        statuses.push(response.statusCode);
        if (response.statusCode === 201) rateLimitEmails.push(email);
      }
      // The first several succeed (real accounts, real rows) before the limiter engages.
      expect(statuses.filter((s) => s === 201).length).toBeGreaterThan(0);
      // At least one request in this burst was throttled.
      expect(statuses).toContain(429);
    }, 20_000); // 12 sequential real bcrypt hashes can run slow under full-suite parallel load

    it('POST /auth/login: repeated failed login attempts against the same account are eventually throttled', async () => {
      const suffix = Date.now();
      const email = `ratelimit-login-${suffix}@twin.test`;
      const signup = await rateLimitApp.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: { fullName: 'Login Rate Limit Test', email, password: 'correct-password-123' },
      });
      expect(signup.statusCode).toBe(201);
      rateLimitEmails.push(email);

      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) {
        const response = await rateLimitApp.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email, password: 'totally-wrong-password' },
        });
        statuses.push(response.statusCode);
      }
      // Every unthrottled attempt with a wrong password is a genuine 401 — never fabricated success.
      for (const status of statuses) {
        expect([401, 429]).toContain(status);
      }
      expect(statuses).toContain(429);
    }, 20_000);

    it('a 429 response includes a Retry-After so a legitimate client knows when it can try again', async () => {
      const suffix = Date.now();
      let last: Awaited<ReturnType<typeof rateLimitApp.inject>> | undefined;
      for (let i = 0; i < 12; i++) {
        const email = `retry-after-${suffix}-${i}@twin.test`;
        last = await rateLimitApp.inject({
          method: 'POST',
          url: '/auth/signup',
          payload: { fullName: 'Retry After Test', email, password: 'password123' },
        });
        if (last.statusCode === 201) rateLimitEmails.push(email);
        if (last.statusCode === 429) break;
      }
      expect(last?.statusCode).toBe(429);
      expect(last?.headers['retry-after']).toBeDefined();
    }, 20_000);
  });

  describe('malformed/missing authentication', () => {
    it('a request with no Authorization header is rejected with 401', async () => {
      const response = await app.inject({ method: 'GET', url: '/auth/me' });
      expect(response.statusCode).toBe(401);
    });

    it('a garbage/malformed bearer token is rejected with 401, not a 500', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: 'Bearer not-a-real-jwt-at-all' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('a well-formed but invalid-signature JWT is rejected with 401', async () => {
      // Correct JWT shape (three base64url segments), but signed with nothing this server recognizes.
      const fakeJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmYWtlLXVzZXItaWQifQ.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${fakeJwt}` },
      });
      expect(response.statusCode).toBe(401);
    });

    it('an oversized login password is rejected with a clean 400, never reaching bcrypt', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'someone@twin.test', password: 'x'.repeat(10_000) },
      });
      expect(response.statusCode).toBe(400);
    });

    it('POST /auth/refresh with no refresh token at all is rejected with 401', async () => {
      const response = await app.inject({ method: 'POST', url: '/auth/refresh', payload: {} });
      expect(response.statusCode).toBe(401);
    });

    it('POST /auth/refresh with a garbage refresh token is rejected with 401, not a 500', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: 'this-is-not-a-real-refresh-token' },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('logout / session invalidation', () => {
    it('a refresh token is genuinely invalidated after logout — reusing it afterward fails', async () => {
      const suffix = Date.now();
      const email = `logout-invalidation-${suffix}@twin.test`;
      const signup = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: { fullName: 'Logout Test', email, password: 'password123' },
      });
      expect(signup.statusCode).toBe(201);
      cleanupEmails.push(email);
      const refreshToken = signup.json().refreshToken as string;

      const logout = await app.inject({ method: 'POST', url: '/auth/logout', payload: { refreshToken } });
      expect(logout.statusCode).toBe(204);

      const reuseAttempt = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken },
      });
      expect(reuseAttempt.statusCode).toBe(401);
    });

    it('rotating a refresh token invalidates the OLD token — replaying it after rotation fails', async () => {
      const suffix = Date.now();
      const email = `rotation-invalidation-${suffix}@twin.test`;
      const signup = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: { fullName: 'Rotation Test', email, password: 'password123' },
      });
      expect(signup.statusCode).toBe(201);
      cleanupEmails.push(email);
      const originalRefreshToken = signup.json().refreshToken as string;

      const rotated = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: originalRefreshToken },
      });
      expect(rotated.statusCode).toBe(200);
      expect(rotated.json().refreshToken).not.toBe(originalRefreshToken);

      const replay = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: originalRefreshToken },
      });
      expect(replay.statusCode).toBe(401);
    });
  });

  describe('cross-account isolation via auth', () => {
    it('user A\'s access token can never authenticate as user B — /auth/me always returns the token\'s own owner', async () => {
      const suffix = Date.now();
      const emailA = `cross-account-a-${suffix}@twin.test`;
      const emailB = `cross-account-b-${suffix}@twin.test`;
      const signupA = await app.inject({ method: 'POST', url: '/auth/signup', payload: { fullName: 'A', email: emailA, password: 'password123' } });
      const signupB = await app.inject({ method: 'POST', url: '/auth/signup', payload: { fullName: 'B', email: emailB, password: 'password123' } });
      cleanupEmails.push(emailA, emailB);

      const meA = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${signupA.json().accessToken}` } });
      const meB = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${signupB.json().accessToken}` } });

      expect(meA.json().id).toBe(signupA.json().user.id);
      expect(meB.json().id).toBe(signupB.json().user.id);
      expect(meA.json().id).not.toBe(meB.json().id);
    });
  });
});
