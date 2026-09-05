import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  entityDetailResponseSchema,
  relatedEntitiesResponseSchema,
  relationshipEvidenceResponseSchema,
  connectedRelationshipDtoSchema,
  createRelationshipRequestSchema,
  traverseQuerySchema,
  errorResponseSchema,
  type EntityDetailResponse,
  type RelatedEntitiesResponse,
  type RelationshipEvidenceResponse,
  type ConnectedRelationshipDto,
  type EntityDto,
  type EntityRelationshipDto,
} from '@twin/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { authenticate, getAuthenticatedUserId } from '../../plugins/authenticate.js';
import { toMemoryDetailDto } from '../memories/memories.routes.js';
import { getEntityDetail, getRelatedEntities, getRelationshipEvidenceDetail, GraphError } from './graph.service.js';
import { getEntityById, EntityError, type EntityRow } from '../entities/entities.service.js';
import { createUserRelationship, deleteRelationship, RelationshipError, type EntityRelationshipRow } from './relationships.service.js';

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

function toRelationshipDto(row: EntityRelationshipRow): EntityRelationshipDto {
  return {
    id: row.id,
    fromEntityId: row.fromEntityId,
    toEntityId: row.toEntityId,
    relationshipType: row.relationshipType,
    epistemicStatus: row.epistemicStatus,
    confidence: Number(row.confidence),
    extractionMethod: row.extractionMethod,
    sourceMemoryId: row.sourceMemoryId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function handleGraphError(err: unknown): { statusCode: 404; body: { error: string; message: string } } {
  if (err instanceof GraphError) {
    // Every GraphError thrown in this module is currently a 404 (not
    // found / doesn't belong to this user) — narrowed to the literal
    // so it matches the routes' declared response schemas.
    return { statusCode: 404, body: { error: 'graph_error', message: err.message } };
  }
  throw err;
}

/** Handles the three ownership/validation failure shapes a relationship mutation can hit: EntityError (unknown/foreign entity id), RelationshipError (self-loop, duplicate, not found). */
function handleRelationshipError(err: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (err instanceof EntityError || err instanceof RelationshipError) {
    reply.code(err.statusCode);
    return { error: 'relationship_error', message: err.message };
  }
  request.log.error(err);
  reply.code(500);
  return { error: 'internal_error', message: 'Something went wrong. Please try again.' };
}

/**
 * Graph API — entity detail, related entities (bounded traversal), and
 * relationship evidence. Every route derives userId from the
 * authenticated request only; nothing here ever reads a user id from
 * params/query/body, so there is no way for a client to request
 * another user's graph.
 */
export async function registerGraphRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    '/entities/:id',
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: entityDetailResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      try {
        const detail = await getEntityDetail(app.db, userId, request.params.id);
        const response: EntityDetailResponse = {
          entity: toEntityDto(detail.entity),
          subtype: detail.subtype,
          relationships: detail.relationships.map((r) => ({
            relationship: toRelationshipDto(r.relationship),
            connectedEntity: toEntityDto(r.connectedEntity),
            direction: r.direction,
          })),
          supportingMemories: detail.supportingMemories.map(toMemoryDetailDto),
        };
        return response;
      } catch (err) {
        const handled = handleGraphError(err);
        reply.code(handled.statusCode);
        return handled.body;
      }
    },
  );

  server.get(
    '/entities/:id/related',
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: traverseQuerySchema,
        response: { 200: relatedEntitiesResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      try {
        const result = await getRelatedEntities(app.db, userId, request.params.id, {
          hops: request.query.hops as 1 | 2,
          includeArchived: request.query.includeArchived,
        });
        const response: RelatedEntitiesResponse = {
          entity: toEntityDto(result.entity),
          nodes: result.nodes.map((n) => ({
            entity: toEntityDto(n.entity),
            hopDistance: n.hopDistance,
            viaRelationship: n.viaRelationship ?? null,
          })),
        };
        return response;
      } catch (err) {
        const handled = handleGraphError(err);
        reply.code(handled.statusCode);
        return handled.body;
      }
    },
  );

  server.get(
    '/relationships/:id/evidence',
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: relationshipEvidenceResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      try {
        const detail = await getRelationshipEvidenceDetail(app.db, userId, request.params.id);
        const response: RelationshipEvidenceResponse = {
          relationship: toRelationshipDto(detail.relationship),
          fromEntity: toEntityDto(detail.fromEntity),
          toEntity: toEntityDto(detail.toEntity),
          evidence: detail.evidence.map((e) => ({
            id: e.id,
            relationshipId: e.relationshipId,
            memoryId: e.memoryId,
            epistemicStatus: e.epistemicStatus,
            confidence: Number(e.confidence),
            extractionMethod: e.extractionMethod,
            evidenceText: e.evidenceText,
            createdAt: e.createdAt.toISOString(),
            memory: e.memory ? toMemoryDetailDto(e.memory) : null,
          })),
        };
        return response;
      } catch (err) {
        const handled = handleGraphError(err);
        reply.code(handled.statusCode);
        return handled.body;
      }
    },
  );

  /**
   * Phase 27: a user directly connecting the entity being viewed
   * (`:id`, always fromEntityId) to another EXISTING entity of theirs.
   * Both entity ids are ownership-checked before anything is written —
   * a client cannot connect to, or claim to own, another user's
   * entity. Reuses connectedRelationshipDtoSchema (the exact shape
   * GET /entities/:id already returns per relationship) so the client
   * can splice the new row straight into its existing list without a
   * second round trip.
   */
  server.post(
    '/entities/:id/relationships',
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: createRelationshipRequestSchema,
        response: { 201: connectedRelationshipDtoSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      try {
        const [fromEntity, toEntity] = await Promise.all([
          getEntityById(app.db, userId, request.params.id),
          getEntityById(app.db, userId, request.body.toEntityId),
        ]);
        if (!fromEntity) throw new EntityError(`Entity not found: ${request.params.id}`, 404);
        if (!toEntity) throw new EntityError(`Entity not found: ${request.body.toEntityId}`, 404);

        const created = await createUserRelationship(app.db, userId, {
          fromEntityId: request.params.id,
          toEntityId: request.body.toEntityId,
          relationshipType: request.body.relationshipType,
        });
        reply.code(201);
        const response: ConnectedRelationshipDto = {
          relationship: toRelationshipDto(created),
          connectedEntity: toEntityDto(toEntity),
          direction: 'outgoing',
        };
        return response;
      } catch (err) {
        return handleRelationshipError(err, request, reply);
      }
    },
  );

  /**
   * Removes one relationship. Ownership-checked, cascades only to that
   * relationship's own evidence rows (see deleteRelationship's doc
   * comment) — never touches either entity or any memory.
   */
  server.delete(
    '/relationships/:id',
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.void(), 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      try {
        await deleteRelationship(app.db, userId, request.params.id);
        reply.code(204);
      } catch (err) {
        return handleRelationshipError(err, request, reply);
      }
    },
  );
}
