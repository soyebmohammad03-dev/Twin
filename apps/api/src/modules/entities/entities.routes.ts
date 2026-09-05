import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  createEntityRequestSchema,
  listEntitiesQuerySchema,
  entityDtoSchema,
  errorResponseSchema,
  type EntityDto,
} from '@twin/contracts';
import { authenticate, getAuthenticatedUserId } from '../../plugins/authenticate.js';
import { findOrCreateEntity, listEntities, type EntityRow } from './entities.service.js';
import { z } from 'zod';

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

/**
 * Minimal entity CRUD — just enough to create the people/projects/
 * goals/decisions/ideas/events that memories link against, and to
 * look them up (find-or-create from a client). Not full CRUD: no
 * update/delete endpoints yet, since nothing in this phase needs them.
 */
export async function registerEntityRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/',
    {
      preHandler: authenticate,
      schema: {
        body: createEntityRequestSchema,
        // 201 when a new entity was actually created; 200 when an
        // exact (case/whitespace/punctuation-insensitive) match already
        // existed and was reused instead — see entities.service.ts's
        // findOrCreateEntity. A client that doesn't care which
        // happened can treat both as success.
        response: { 200: entityDtoSchema, 201: entityDtoSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      const { entity, wasCreated } = await findOrCreateEntity(app.db, userId, request.body);
      reply.code(wasCreated ? 201 : 200);
      return toEntityDto(entity);
    },
  );

  server.get(
    '/',
    {
      preHandler: authenticate,
      schema: {
        querystring: listEntitiesQuerySchema,
        response: { 200: z.array(entityDtoSchema), 401: errorResponseSchema },
      },
    },
    async (request) => {
      const userId = getAuthenticatedUserId(request);
      const rows = await listEntities(app.db, userId, request.query);
      return rows.map(toEntityDto);
    },
  );
}
