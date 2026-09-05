import { z } from 'zod';

/**
 * Liveness check — always answerable without any dependency.
 */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  uptimeSeconds: z.number(),
  timestamp: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/**
 * Readiness check against Postgres. Reports real failures — never
 * synthesizes an "ok" when the database is unreachable.
 */
export const dbHealthResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), latencyMs: z.number() }),
  z.object({ status: z.literal('error'), message: z.string() }),
]);
export type DbHealthResponse = z.infer<typeof dbHealthResponseSchema>;
