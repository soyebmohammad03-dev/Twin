import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { entities, type Queryable } from '@twin/db';
import {
  insightsResponseSchema,
  insightDtoSchema,
  insightEvidenceResponseSchema,
  insightContextResponseSchema,
  rebuildInsightsResponseSchema,
  errorResponseSchema,
  type InsightDto,
  type InsightsResponse,
  type InsightEvidenceResponse,
  type InsightContextResponse,
  type RebuildInsightsResponse,
  type InsightType,
} from '@twin/contracts';
import { authenticate, getAuthenticatedUserId } from '../../plugins/authenticate.js';
import { toMemoryDetailDto } from '../memories/memories.routes.js';
import { attachEntityInfo as attachPersonalModelEntityInfo, toFactDto } from '../personalModel/personalModel.routes.js';
import { rebuildInsights } from './insightsStore.js';
import {
  getCurrentInsights,
  getInsightEvidence,
  getInsightPersonalModelContext,
  dismissInsight,
  InsightError,
  type InsightEvidenceResult,
} from './insightsService.js';
import type { InsightRow } from './insightsStore.js';

const insightActionResponseSchema = z.object({ insight: insightDtoSchema });

async function attachEntityInfo(db: Queryable, userId: string, rows: InsightRow[]): Promise<Map<string, { name: string; entityType: string }>> {
  const entityIds = [...new Set(rows.map((r) => r.subjectEntityId).filter((id): id is string => Boolean(id)))];
  if (entityIds.length === 0) return new Map();
  const entityRows = await db
    .select({ id: entities.id, name: entities.name, entityType: entities.entityType })
    .from(entities)
    .where(and(eq(entities.userId, userId), inArray(entities.id, entityIds)));
  return new Map(entityRows.map((r) => [r.id, { name: r.name, entityType: r.entityType }]));
}

function toInsightDto(row: InsightRow, entityInfo: Map<string, { name: string; entityType: string }>): InsightDto {
  const info = row.subjectEntityId ? entityInfo.get(row.subjectEntityId) : undefined;
  return {
    id: row.id,
    insightType: row.insightType as InsightType,
    subjectKey: row.subjectKey,
    statusClass: row.statusClass as InsightDto['statusClass'],
    temporalState: row.temporalState as InsightDto['temporalState'],
    title: row.title,
    description: row.description,
    confidence: Number(row.confidence),
    subjectEntityId: row.subjectEntityId,
    subjectEntityName: info?.name ?? null,
    subjectEntityType: (info?.entityType as InsightDto['subjectEntityType']) ?? null,
    firstObservedAt: row.firstObservedAt.toISOString(),
    lastObservedAt: row.lastObservedAt.toISOString(),
    observationCount: row.observationCount,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    supersededByInsightId: row.supersededByInsightId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function toEvidenceResponse(db: Queryable, userId: string, result: InsightEvidenceResult): Promise<InsightEvidenceResponse> {
  const entityInfo = await attachEntityInfo(db, userId, [result.insight]);
  return {
    insight: toInsightDto(result.insight, entityInfo),
    evidence: result.evidence.map((e) => ({
      id: e.id,
      insightId: e.insightId,
      evidenceType: e.evidenceType as InsightEvidenceResponse['evidence'][number]['evidenceType'],
      memoryId: e.memoryId,
      entityId: e.entityId,
      relationshipId: e.relationshipId,
      personalModelFactId: e.personalModelFactId,
      sourceInsightId: e.sourceInsightId,
      evidenceText: e.evidenceText,
      observedAt: e.observedAt.toISOString(),
      createdAt: e.createdAt.toISOString(),
      supersededAt: e.supersededAt?.toISOString() ?? null,
      memory: e.memory ? toMemoryDetailDto(e.memory) : null,
    })),
  };
}

function handleInsightError(err: unknown): { statusCode: 404; body: { error: string; message: string } } {
  if (err instanceof InsightError) {
    return { statusCode: 404, body: { error: 'insight_error', message: err.message } };
  }
  throw err;
}

/**
 * Phase 10's Insight API. userId comes ONLY from the authenticated
 * request in every handler below — same isolation discipline as
 * personalModel.routes.ts. GET /insights reads the persisted set
 * directly (no rebuild); POST /insights/rebuild is the only place a
 * rebuild happens.
 */
export async function registerInsightsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    '/',
    {
      preHandler: authenticate,
      schema: { response: { 200: insightsResponseSchema } },
    },
    async (request) => {
      const userId = getAuthenticatedUserId(request);
      const rows = await getCurrentInsights(app.db, userId);
      const entityInfo = await attachEntityInfo(app.db, userId, rows);
      const response: InsightsResponse = {
        insights: rows.map((r) => toInsightDto(r, entityInfo)),
        generatedAt: new Date().toISOString(),
      };
      return response;
    },
  );

  server.post(
    '/rebuild',
    {
      preHandler: authenticate,
      schema: { response: { 200: rebuildInsightsResponseSchema } },
    },
    async (request) => {
      const userId = getAuthenticatedUserId(request);
      const result = await rebuildInsights(app.db, userId);
      const response: RebuildInsightsResponse = {
        insightCount: result.insightCount,
        generatedAt: new Date().toISOString(),
      };
      return response;
    },
  );

  server.get(
    '/:id/evidence',
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: insightEvidenceResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      try {
        const result = await getInsightEvidence(app.db, userId, request.params.id);
        return await toEvidenceResponse(app.db, userId, result);
      } catch (err) {
        const handled = handleInsightError(err);
        reply.code(handled.statusCode);
        return handled.body;
      }
    },
  );

  server.get(
    '/:id/context',
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: insightContextResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      try {
        const result = await getInsightPersonalModelContext(app.db, userId, request.params.id);
        const insightEntityInfo = await attachEntityInfo(app.db, userId, [result.insight]);
        const factEntityInfo = await attachPersonalModelEntityInfo(app.db, userId, [...result.directFacts, ...result.relatedFacts]);
        const response: InsightContextResponse = {
          insight: toInsightDto(result.insight, insightEntityInfo),
          directFacts: result.directFacts.map((f) => toFactDto(f, factEntityInfo)),
          relatedFacts: result.relatedFacts.map((f) => toFactDto(f, factEntityInfo)),
        };
        return response;
      } catch (err) {
        const handled = handleInsightError(err);
        reply.code(handled.statusCode);
        return handled.body;
      }
    },
  );

  server.post(
    '/:id/dismiss',
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: insightActionResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      try {
        const row = await dismissInsight(app.db, userId, request.params.id);
        const entityInfo = await attachEntityInfo(app.db, userId, [row]);
        return { insight: toInsightDto(row, entityInfo) };
      } catch (err) {
        const handled = handleInsightError(err);
        reply.code(handled.statusCode);
        return handled.body;
      }
    },
  );
}
