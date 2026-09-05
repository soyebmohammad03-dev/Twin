import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  searchMemoriesRequestSchema,
  searchMemoriesResponseSchema,
  errorResponseSchema,
  type SearchMemoriesResponse,
} from '@twin/contracts';
import { authenticate, getAuthenticatedUserId } from '../../plugins/authenticate.js';
import { searchMemories, type SearchMemoriesResult } from './retrieval.service.js';
import { toMemoryDetailDto } from '../memories/memories.routes.js';

function toSearchMemoriesResponse(result: SearchMemoriesResult): SearchMemoriesResponse {
  return {
    results: result.results.map((r) => ({
      memory: toMemoryDetailDto(r.memory),
      score: r.score,
      signals: r.signals,
      matchedEntities: r.matchedEntities.map((e) => ({
        id: e.id,
        name: e.name,
        entityType: e.entityType,
        matchType: e.matchType,
      })),
      matchReasons: r.matchReasons,
    })),
    matchedEntities: result.matchedEntities.map((e) => ({
      id: e.id,
      name: e.name,
      entityType: e.entityType,
      matchType: e.matchType,
    })),
    queryEmbeddingGenerated: result.queryEmbeddingGenerated,
  };
}

/**
 * POST /search — hybrid memory retrieval. GET would be the more
 * RESTful verb for a read, but the query can legitimately be long
 * (up to 2000 chars) and carry several optional filters, so this
 * follows the same POST-for-a-structured-read convention as the rest
 * of this API's non-trivial reads would if they existed; there is no
 * side effect and nothing is created.
 */
export async function registerRetrievalRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/',
    {
      preHandler: authenticate,
      schema: {
        body: searchMemoriesRequestSchema,
        response: { 200: searchMemoriesResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request) => {
      // userId comes ONLY from the authenticated JWT — never from the
      // request body, even if a client sent one. This is the single
      // choke point every retrieval query passes through.
      const userId = getAuthenticatedUserId(request);
      const result = await searchMemories(app.db, userId, {
        query: request.body.query,
        limit: request.body.limit,
        includeArchived: request.body.includeArchived,
        occurredAfter: request.body.occurredAfter ? new Date(request.body.occurredAfter) : undefined,
        occurredBefore: request.body.occurredBefore ? new Date(request.body.occurredBefore) : undefined,
        logger: request.log,
      });
      return toSearchMemoriesResponse(result);
    },
  );
}
