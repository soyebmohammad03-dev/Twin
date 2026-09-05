import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { chatRequestSchema, chatResponseSchema, errorResponseSchema, type ChatResponse } from '@twin/contracts';
import { authenticate, getAuthenticatedUserId } from '../../plugins/authenticate.js';
import { sendChatMessage, ContextError } from './chatService.js';

function handleChatError(err: unknown): { statusCode: 404; body: { error: string; message: string } } {
  if (err instanceof ContextError) {
    return { statusCode: 404, body: { error: 'context_error', message: err.message } };
  }
  throw err;
}

/**
 * Phase 20's Twin Chat API — the real, authenticated request flow the
 * frontend's Twin Chat UI talks to. This route is deliberately thin: it
 * only translates the HTTP request into sendChatMessage()'s input and
 * returns the result. All retrieval, context assembly, reasoning, and
 * citation validation live in chatService.ts / contextEngine.ts /
 * reasoningProvider.ts — there is no parallel implementation of any of
 * those here, and no direct database access in this file beyond what
 * `app.db` (passed straight through) already provides those layers.
 *
 * userId comes ONLY from the authenticated JWT (exactly like
 * context.routes.ts / reasoning.routes.ts), so a chat request can never
 * see another user's memories, entities, Personal Model, or insights.
 */
export async function registerChatRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/',
    {
      preHandler: authenticate,
      schema: {
        body: chatRequestSchema,
        response: { 200: chatResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      try {
        const result: ChatResponse = await sendChatMessage(app.db, userId, {
          query: request.body.message,
          targetEntityId: request.body.targetEntityId,
          personEntityId: request.body.personEntityId,
          projectEntityId: request.body.projectEntityId,
          goalEntityId: request.body.goalEntityId,
          decisionEntityId: request.body.decisionEntityId,
          occurredAfter: request.body.occurredAfter ? new Date(request.body.occurredAfter) : undefined,
          occurredBefore: request.body.occurredBefore ? new Date(request.body.occurredBefore) : undefined,
          graphHops: request.body.graphHops,
          budget: request.body.budget,
          conversationHistory: request.body.conversationHistory,
        }, { logger: request.log });
        return result;
      } catch (err) {
        const handled = handleChatError(err);
        reply.code(handled.statusCode);
        return handled.body;
      }
    },
  );
}
