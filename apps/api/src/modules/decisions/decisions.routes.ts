import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createDecisionRequestSchema,
  updateDecisionRequestSchema,
  decisionDtoSchema,
  listDecisionsResponseSchema,
  decisionDetailResponseSchema,
  listDecisionHistoryResponseSchema,
  errorResponseSchema,
  type DecisionDto,
  type DecisionDetailResponse,
  type ListDecisionHistoryResponse,
  type EntityDto,
} from '@twin/contracts';
import { authenticate, getAuthenticatedUserId } from '../../plugins/authenticate.js';
import {
  createDecision,
  listDecisions,
  getDecisionById,
  updateDecision,
  listDecisionHistory,
  decisionIdsWithEvidence,
  DecisionError,
  type DecisionWithEntity,
} from './decisions.service.js';
import { getEntityDetail } from '../graph/graph.service.js';
import type { EntityRow } from '../entities/entities.service.js';
import { toMemoryDetailDto } from '../memories/memories.routes.js';
import { buildDecisionContext } from './decisionContext.js';

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

function toDecisionDto({ entity, decision }: DecisionWithEntity, hasEvidence: boolean): DecisionDto {
  return {
    id: entity.id,
    entityType: entity.entityType,
    name: entity.name,
    description: entity.description,
    metadata: entity.metadata as Record<string, unknown>,
    archivedAt: entity.archivedAt?.toISOString() ?? null,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
    status: decision.status as DecisionDto['status'],
    outcome: decision.outcome,
    decidedAt: decision.decidedAt?.toISOString() ?? null,
    hasEvidence,
  };
}

function handleDecisionError(err: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (err instanceof DecisionError) {
    reply.code(err.statusCode);
    return { error: 'decision_error', message: err.message };
  }
  request.log.error(err);
  reply.code(500);
  return { error: 'internal_error', message: 'Something went wrong. Please try again.' };
}

/**
 * Phase 25's Decision API. Deliberately thin: entity + graph
 * relationships + supporting memories are already served generically
 * by graph.service.getEntityDetail (the exact same function
 * GET /graph/entities/:id uses) — this module only adds what's
 * actually decision-specific: the status/outcome/decidedAt subtype
 * fields (previously never written anywhere, see decisions.service.ts)
 * and the deterministic known/unknown context summary. No second
 * retrieval implementation, no parallel reasoning system.
 */
export async function registerDecisionRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/',
    {
      preHandler: authenticate,
      schema: {
        body: createDecisionRequestSchema,
        response: { 201: decisionDtoSchema, 401: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      const result = await createDecision(app.db, userId, {
        name: request.body.name,
        description: request.body.description,
        status: request.body.status,
        outcome: request.body.outcome,
        decidedAt: request.body.decidedAt !== undefined ? new Date(request.body.decidedAt) : undefined,
      });
      reply.code(201);
      // A freshly-created decision has no evidence yet — this endpoint
      // never links memories/relationships itself.
      return toDecisionDto(result, false);
    },
  );

  server.get(
    '/',
    {
      preHandler: authenticate,
      schema: {
        response: { 200: listDecisionsResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request) => {
      const userId = getAuthenticatedUserId(request);
      const rows = await listDecisions(app.db, userId);
      const evidenceIds = await decisionIdsWithEvidence(app.db, userId, rows.map((r) => r.entity.id));
      return rows.map((r) => toDecisionDto(r, evidenceIds.has(r.entity.id)));
    },
  );

  server.get(
    '/:id',
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: decisionDetailResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      try {
        const result = await getDecisionById(app.db, userId, request.params.id);
        const detail = await getEntityDetail(app.db, userId, request.params.id);
        const hasEvidence = detail.relationships.length > 0 || detail.supportingMemories.length > 0;
        const response: DecisionDetailResponse = {
          decision: toDecisionDto(result, hasEvidence),
          relationships: detail.relationships.map((r) => ({
            relationship: {
              id: r.relationship.id,
              fromEntityId: r.relationship.fromEntityId,
              toEntityId: r.relationship.toEntityId,
              relationshipType: r.relationship.relationshipType,
              epistemicStatus: r.relationship.epistemicStatus,
              confidence: Number(r.relationship.confidence),
              extractionMethod: r.relationship.extractionMethod,
              sourceMemoryId: r.relationship.sourceMemoryId,
              createdAt: r.relationship.createdAt.toISOString(),
              updatedAt: r.relationship.updatedAt.toISOString(),
            },
            connectedEntity: toEntityDto(r.connectedEntity),
            direction: r.direction,
          })),
          supportingMemories: detail.supportingMemories.map(toMemoryDetailDto),
          context: buildDecisionContext({
            status: result.decision.status as DecisionDto['status'],
            outcome: result.decision.outcome,
            decidedAt: result.decision.decidedAt?.toISOString() ?? null,
            relationshipCount: detail.relationships.length,
            linkedMemoryCount: detail.supportingMemories.length,
          }),
        };
        return response;
      } catch (err) {
        return handleDecisionError(err, request, reply);
      }
    },
  );

  server.patch(
    '/:id',
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: updateDecisionRequestSchema,
        response: { 200: decisionDtoSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      try {
        const result = await updateDecision(app.db, userId, request.params.id, {
          status: request.body.status,
          outcome: request.body.outcome,
          decidedAt: request.body.decidedAt === undefined ? undefined : request.body.decidedAt === null ? null : new Date(request.body.decidedAt),
        });
        const evidenceIds = await decisionIdsWithEvidence(app.db, userId, [request.params.id]);
        return toDecisionDto(result, evidenceIds.has(request.params.id));
      } catch (err) {
        return handleDecisionError(err, request, reply);
      }
    },
  );

  server.get(
    '/:id/history',
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: listDecisionHistoryResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      try {
        const rows = await listDecisionHistory(app.db, userId, request.params.id);
        const response: ListDecisionHistoryResponse = rows.map((row) => ({
          id: row.id,
          previousStatus: row.previousStatus as DecisionDto['status'],
          newStatus: row.newStatus as DecisionDto['status'],
          previousOutcome: row.previousOutcome,
          newOutcome: row.newOutcome,
          previousDecidedAt: row.previousDecidedAt?.toISOString() ?? null,
          newDecidedAt: row.newDecidedAt?.toISOString() ?? null,
          changedAt: row.changedAt.toISOString(),
        }));
        return response;
      } catch (err) {
        return handleDecisionError(err, request, reply);
      }
    },
  );
}
