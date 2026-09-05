import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createMemoryRequestSchema,
  updateMemoryRequestSchema,
  listMemoriesQuerySchema,
  linkMemoryEntityRequestSchema,
  memoryDetailDtoSchema,
  memoryEntityLinkDtoSchema,
  listMemoryCorrectionsResponseSchema,
  errorResponseSchema,
  type MemoryDetailDto,
  type EntityDto,
  type ListMemoryCorrectionsResponse,
} from '@twin/contracts';
import { authenticate, getAuthenticatedUserId } from '../../plugins/authenticate.js';
import {
  createMemory,
  getMemoryDetail,
  listMemories,
  updateMemory,
  archiveMemory,
  linkMemoryToEntity,
  listMemoryCorrections,
  MemoryError,
  type MemoryWithRelations,
} from './memories.service.js';
import { EntityError, type EntityRow } from '../entities/entities.service.js';
import { embedMemory } from '../retrieval/embedding.service.js';

function toEntityDto(entity: EntityRow): EntityDto {
  return {
    id: entity.id,
    entityType: entity.entityType,
    name: entity.name,
    description: entity.description,
    metadata: entity.metadata as Record<string, unknown>,
    archivedAt: entity.archivedAt?.toISOString() ?? null,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

export function toMemoryDetailDto(row: MemoryWithRelations): MemoryDetailDto {
  return {
    id: row.id,
    sourceId: row.sourceId,
    memoryType: row.memoryType,
    content: row.content,
    epistemicStatus: row.epistemicStatus,
    confidence: Number(row.confidence),
    importance: row.importance,
    occurredAt: row.occurredAt?.toISOString() ?? null,
    metadata: row.metadata as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    source: {
      id: row.source.id,
      sourceType: row.source.sourceType,
      title: row.source.title,
      rawContent: row.source.rawContent,
      url: row.source.url,
      capturedAt: row.source.capturedAt?.toISOString() ?? null,
      metadata: row.source.metadata as Record<string, unknown>,
      createdAt: row.source.createdAt.toISOString(),
    },
    entityLinks: row.entityLinks.map((link) => ({
      id: link.id,
      memoryId: link.memoryId,
      entityId: link.entityId,
      role: link.role,
      createdAt: link.createdAt.toISOString(),
      entity: toEntityDto(link.entity),
    })),
  };
}

function handleServiceError(err: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (err instanceof MemoryError || err instanceof EntityError) {
    reply.code(err.statusCode);
    return { error: 'memory_error', message: err.message };
  }
  request.log.error(err);
  reply.code(500);
  return { error: 'internal_error', message: 'Something went wrong. Please try again.' };
}

export async function registerMemoryRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/',
    {
      preHandler: authenticate,
      schema: {
        body: createMemoryRequestSchema,
        response: { 201: memoryDetailDtoSchema, 400: errorResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      try {
        const memoryId = await createMemory(app.db, userId, request.body);
        const detail = await getMemoryDetail(app.db, userId, memoryId);
        if (!detail) {
          throw new Error('Memory not found immediately after creation.');
        }
        // Best-effort, failure-safe — mirrors the AI extraction pattern
        // (ingestion.service.ts): embedding is enrichment, never a
        // reason a successfully-created memory should fail the request.
        await embedMemory(app.db, userId, memoryId).catch((err) => request.log.error(err, 'embedMemory failed'));
        reply.code(201);
        return toMemoryDetailDto(detail);
      } catch (err) {
        return handleServiceError(err, request, reply);
      }
    },
  );

  server.get(
    '/',
    {
      preHandler: authenticate,
      schema: {
        querystring: listMemoriesQuerySchema,
        response: { 200: z.array(memoryDetailDtoSchema), 401: errorResponseSchema },
      },
    },
    async (request) => {
      const userId = getAuthenticatedUserId(request);
      const rows = await listMemories(app.db, userId, request.query);
      return rows.map(toMemoryDetailDto);
    },
  );

  server.get(
    '/:id',
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: memoryDetailDtoSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      const detail = await getMemoryDetail(app.db, userId, request.params.id);
      if (!detail) {
        reply.code(404);
        return { error: 'not_found', message: 'Memory not found.' };
      }
      return toMemoryDetailDto(detail);
    },
  );

  server.patch(
    '/:id',
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: updateMemoryRequestSchema,
        response: { 200: memoryDetailDtoSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      const updated = await updateMemory(app.db, userId, request.params.id, request.body);
      if (!updated) {
        reply.code(404);
        return { error: 'not_found', message: 'Memory not found.' };
      }
      if (request.body.content !== undefined) {
        // Phase 30: content changed, so the stored embedding (if any) is
        // now stale — re-embed the same way memory creation does.
        // embedMemory() itself is the idempotency guard for everything
        // else (unchanged content, no provider configured, etc.).
        await embedMemory(app.db, userId, request.params.id).catch((err) => request.log.error(err, 'embedMemory failed'));
      }
      const detail = await getMemoryDetail(app.db, userId, request.params.id);
      if (!detail) {
        throw new Error('Memory not found immediately after update.');
      }
      return toMemoryDetailDto(detail);
    },
  );

  server.delete(
    '/:id',
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      const archived = await archiveMemory(app.db, userId, request.params.id);
      if (!archived) {
        reply.code(404);
        return { error: 'not_found', message: 'Memory not found.' };
      }
      reply.code(204);
    },
  );

  server.get(
    '/:id/corrections',
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: listMemoryCorrectionsResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      try {
        const rows = await listMemoryCorrections(app.db, userId, request.params.id);
        const response: ListMemoryCorrectionsResponse = rows.map((row) => ({
          id: row.id,
          previousContent: row.previousContent,
          newContent: row.newContent,
          changedAt: row.changedAt.toISOString(),
        }));
        return response;
      } catch (err) {
        return handleServiceError(err, request, reply);
      }
    },
  );

  server.post(
    '/:id/entities',
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: linkMemoryEntityRequestSchema,
        response: { 201: memoryEntityLinkDtoSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      try {
        const link = await linkMemoryToEntity(
          app.db,
          userId,
          request.params.id,
          request.body.entityId,
          request.body.role ?? 'related',
        );
        reply.code(201);
        return {
          id: link.id,
          memoryId: link.memoryId,
          entityId: link.entityId,
          role: link.role,
          createdAt: link.createdAt.toISOString(),
        };
      } catch (err) {
        return handleServiceError(err, request, reply);
      }
    },
  );
}
