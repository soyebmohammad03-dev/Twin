import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { reasonRequestSchema, reasonResponseSchema, errorResponseSchema, type GroundedResponse } from '@twin/contracts';
import { authenticate, getAuthenticatedUserId } from '../../plugins/authenticate.js';
import { buildContext, ContextError } from './contextEngine.js';
import { MockReasoningProvider, runReasoningSafely, validateGroundedResponse, type ReasoningProvider } from './reasoningProvider.js';
import { getReasoningProvider } from './geminiReasoningProvider.js';

function handleReasonError(err: unknown): { statusCode: 404; body: { error: string; message: string } } {
  if (err instanceof ContextError) {
    return { statusCode: 404, body: { error: 'context_error', message: err.message } };
  }
  throw err;
}

/**
 * Phase 18's reasoning endpoint — the smallest possible surface over
 * the architecture the brief asks for: authenticated user + query ->
 * the EXACT SAME buildContext() every other caller (POST /context,
 * SearchModal's "View Context") uses -> a ReasoningProvider -> a
 * validated GroundedResponse. No second retrieval implementation, no
 * new context-assembly logic — this route only composes two things
 * that already exist and already have their own dedicated tests.
 *
 * Provider resolution: REASONING_PROVIDER=gemini (configured via
 * geminiReasoningProvider.ts's getReasoningProvider) uses the real
 * model; the default 'none' falls back to MockReasoningProvider — the
 * same graceful-degradation shape embedding-less search already has,
 * never a hard failure and never a silently-fake "real" answer (Mock's
 * output is honestly template-based and never claims otherwise).
 *
 * userId comes ONLY from the authenticated JWT, exactly like
 * context.routes.ts — there is no path for one user's query to ever
 * see another user's ContextPacket or citations.
 */
export async function registerReasoningRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/',
    {
      preHandler: authenticate,
      schema: {
        body: reasonRequestSchema,
        response: { 200: reasonResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      try {
        const packet = await buildContext(app.db, userId, {
          query: request.body.query,
          targetEntityId: request.body.targetEntityId,
          personEntityId: request.body.personEntityId,
          projectEntityId: request.body.projectEntityId,
          goalEntityId: request.body.goalEntityId,
          decisionEntityId: request.body.decisionEntityId,
          occurredAfter: request.body.occurredAfter ? new Date(request.body.occurredAfter) : undefined,
          occurredBefore: request.body.occurredBefore ? new Date(request.body.occurredBefore) : undefined,
          graphHops: request.body.graphHops,
          budget: request.body.budget,
        }, { logger: request.log });

        const provider: ReasoningProvider = getReasoningProvider() ?? new MockReasoningProvider();
        const raw = await runReasoningSafely(provider, packet, request.body.query);
        const response: GroundedResponse = validateGroundedResponse(raw, packet);
        return response;
      } catch (err) {
        const handled = handleReasonError(err);
        reply.code(handled.statusCode);
        return handled.body;
      }
    },
  );
}
