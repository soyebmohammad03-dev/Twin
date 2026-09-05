import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import { healthResponseSchema, dbHealthResponseSchema } from '@twin/contracts';

export async function registerHealthRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  // Liveness: the process is up. Never touches the database, so this
  // is meaningful even when Postgres is unreachable or unconfigured.
  server.get(
    '/',
    { schema: { response: { 200: healthResponseSchema } } },
    async () => ({
      status: 'ok' as const,
      uptimeSeconds: process.uptime(),
      timestamp: new Date().toISOString(),
    }),
  );

  // Readiness: actually queries Postgres and reports the real result.
  // Returns 503 with the real error message on failure — never a fake
  // "ok".
  server.get(
    '/db',
    { schema: { response: { 200: dbHealthResponseSchema, 503: dbHealthResponseSchema } } },
    async (_request, reply) => {
      const start = performance.now();
      try {
        await app.db.execute(sql`select 1`);
        return { status: 'ok' as const, latencyMs: Math.round(performance.now() - start) };
      } catch (err) {
        reply.code(503);
        return {
          status: 'error' as const,
          message: err instanceof Error ? err.message : 'Unknown database error.',
        };
      }
    },
  );
}
