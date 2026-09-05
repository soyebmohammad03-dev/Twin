import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { buildContextRequestSchema, buildContextResponseSchema, errorResponseSchema, type ContextPacket } from '@twin/contracts';
import { authenticate, getAuthenticatedUserId } from '../../plugins/authenticate.js';
import { buildContext, ContextError } from './contextEngine.js';

function handleContextError(err: unknown): { statusCode: 404; body: { error: string; message: string } } {
  if (err instanceof ContextError) {
    return { statusCode: 404, body: { error: 'context_error', message: err.message } };
  }
  throw err;
}

/**
 * Item 16's Context Engine API. POST /context builds and returns a
 * ContextPacket — deliberately NOT a chat endpoint (no reasoning
 * happens here; see modules/context/reasoningProvider.ts for that
 * abstraction, exercised only in tests this phase). userId comes only
 * from the authenticated request; every explicit target entity id in
 * the body is ownership-checked inside buildContext (404s rather than
 * silently including another user's entity), so there is no path for
 * cross-user context assembly.
 */
export async function registerContextRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/',
    {
      preHandler: authenticate,
      schema: {
        body: buildContextRequestSchema,
        response: { 200: buildContextResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      try {
        const packet: ContextPacket = await buildContext(app.db, userId, {
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
        return packet;
      } catch (err) {
        const handled = handleContextError(err);
        reply.code(handled.statusCode);
        return handled.body;
      }
    },
  );
}
