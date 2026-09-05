import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { entities, personalModelSnapshots, type Queryable } from '@twin/db';
import {
  personalModelResponseSchema,
  personalModelFactDtoSchema,
  factEvidenceResponseSchema,
  modelChangesResponseSchema,
  rebuildModelResponseSchema,
  correctFactRequestSchema,
  errorResponseSchema,
  type PersonalModelFactDto,
  type PersonalModelResponse,
  type FactEvidenceResponse,
  type ModelChangesResponse,
  type RebuildModelResponse,
  type PersonalModelCategory,
} from '@twin/contracts';
import { authenticate, getAuthenticatedUserId } from '../../plugins/authenticate.js';
import { toMemoryDetailDto } from '../memories/memories.routes.js';
import { rebuildPersonalModel } from './personalModelStore.js';
import {
  getCurrentModel,
  uncertainFactIds,
  getFactEvidence,
  listChanges,
  confirmFact,
  correctFact,
  dismissFact,
  PersonalModelError,
  type FactEvidenceResult,
} from './personalModelService.js';
import type { PersonalModelFactRow } from './personalModelStore.js';

const factActionResponseSchema = z.object({ fact: personalModelFactDtoSchema });

/** Exported for reuse by insights.routes.ts (Phase 16's Context endpoint) — the same entity-name batch lookup, just applied to Personal Model facts instead of insights, so that module doesn't duplicate this query. */
export async function attachEntityInfo(
  db: Queryable,
  userId: string,
  facts: PersonalModelFactRow[],
): Promise<Map<string, { name: string; entityType: string }>> {
  const entityIds = [...new Set(facts.map((f) => f.subjectEntityId).filter((id): id is string => Boolean(id)))];
  if (entityIds.length === 0) return new Map();
  const rows = await db
    .select({ id: entities.id, name: entities.name, entityType: entities.entityType })
    .from(entities)
    .where(and(eq(entities.userId, userId), inArray(entities.id, entityIds)));
  return new Map(rows.map((r) => [r.id, { name: r.name, entityType: r.entityType }]));
}

/** Exported for reuse by insights.routes.ts (Phase 16's Context endpoint) — the same row->DTO shaping, so a Personal Model fact renders identically whether reached from Profile or from an insight's Context view. */
export function toFactDto(row: PersonalModelFactRow, entityInfo: Map<string, { name: string; entityType: string }>): PersonalModelFactDto {
  const info = row.subjectEntityId ? entityInfo.get(row.subjectEntityId) : undefined;
  return {
    id: row.id,
    category: row.category as PersonalModelCategory,
    subjectKey: row.subjectKey,
    subjectEntityId: row.subjectEntityId,
    subjectEntityName: info?.name ?? null,
    subjectEntityType: (info?.entityType as PersonalModelFactDto['subjectEntityType']) ?? null,
    factText: row.factText,
    epistemicStatus: row.epistemicStatus,
    confidence: Number(row.confidence),
    stability: row.stability as PersonalModelFactDto['stability'],
    temporalState: row.temporalState as PersonalModelFactDto['temporalState'],
    firstObservedAt: row.firstObservedAt.toISOString(),
    lastObservedAt: row.lastObservedAt.toISOString(),
    observationCount: row.observationCount,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function toEvidenceResponse(db: Queryable, userId: string, result: FactEvidenceResult): Promise<FactEvidenceResponse> {
  const entityInfo = await attachEntityInfo(db, userId, [result.fact]);
  return {
    fact: toFactDto(result.fact, entityInfo),
    evidence: result.evidence.map((e) => ({
      id: e.id,
      factId: e.factId,
      evidenceSource: e.evidenceSource as FactEvidenceResponse['evidence'][number]['evidenceSource'],
      memoryId: e.memoryId,
      relationshipId: e.relationshipId,
      entityId: e.entityId,
      epistemicStatus: e.epistemicStatus,
      confidence: Number(e.confidence),
      evidenceText: e.evidenceText,
      observedAt: e.observedAt.toISOString(),
      createdAt: e.createdAt.toISOString(),
      supersededAt: e.supersededAt?.toISOString() ?? null,
      memory: e.memory ? toMemoryDetailDto(e.memory) : null,
    })),
  };
}

function handlePersonalModelError(err: unknown): { statusCode: 404; body: { error: string; message: string } } {
  if (err instanceof PersonalModelError) {
    return { statusCode: 404, body: { error: 'personal_model_error', message: err.message } };
  }
  throw err;
}

/**
 * Item 14's Personal Model API. userId comes ONLY from the
 * authenticated request in every handler below — never from params,
 * query, or body — so there is no path for cross-user model access.
 * GET /twin/model reads the persisted model directly (no rebuild);
 * POST /twin/model/rebuild is the only place a rebuild happens,
 * matching item 24's "never rebuild on every page load".
 */
export async function registerPersonalModelRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    '/model',
    {
      preHandler: authenticate,
      schema: { response: { 200: personalModelResponseSchema } },
    },
    async (request) => {
      const userId = getAuthenticatedUserId(request);
      const facts = await getCurrentModel(app.db, userId);
      const entityInfo = await attachEntityInfo(app.db, userId, facts);
      const [latestSnapshot] = await app.db
        .select({ version: personalModelSnapshots.version })
        .from(personalModelSnapshots)
        .where(eq(personalModelSnapshots.userId, userId))
        .orderBy(desc(personalModelSnapshots.version))
        .limit(1);

      const response: PersonalModelResponse = {
        facts: facts.map((f) => toFactDto(f, entityInfo)),
        uncertainFactIds: uncertainFactIds(facts),
        generatedAt: new Date().toISOString(),
        snapshotVersion: latestSnapshot?.version ?? null,
      };
      return response;
    },
  );

  server.post(
    '/model/rebuild',
    {
      preHandler: authenticate,
      schema: { response: { 200: rebuildModelResponseSchema } },
    },
    async (request) => {
      const userId = getAuthenticatedUserId(request);
      const result = await rebuildPersonalModel(app.db, userId);
      const response: RebuildModelResponse = {
        snapshotVersion: result.snapshotVersion,
        factCount: result.factCount,
        changes: result.changes.map((c) => ({
          id: c.id,
          factId: c.factId,
          changeType: c.changeType,
          description: c.description,
          evidenceMemoryIds: (c.evidenceMemoryIds as string[]) ?? [],
          createdAt: c.createdAt.toISOString(),
        })),
        generatedAt: new Date().toISOString(),
      };
      return response;
    },
  );

  server.get(
    '/model/changes',
    {
      preHandler: authenticate,
      schema: { response: { 200: modelChangesResponseSchema } },
    },
    async (request) => {
      const userId = getAuthenticatedUserId(request);
      const changes = await listChanges(app.db, userId);
      const response: ModelChangesResponse = {
        changes: changes.map((c) => ({
          id: c.id,
          factId: c.factId,
          changeType: c.changeType,
          description: c.description,
          evidenceMemoryIds: (c.evidenceMemoryIds as string[]) ?? [],
          createdAt: c.createdAt.toISOString(),
        })),
      };
      return response;
    },
  );

  server.get(
    '/facts/:id/evidence',
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: factEvidenceResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      try {
        const result = await getFactEvidence(app.db, userId, request.params.id);
        return await toEvidenceResponse(app.db, userId, result);
      } catch (err) {
        const handled = handlePersonalModelError(err);
        reply.code(handled.statusCode);
        return handled.body;
      }
    },
  );

  server.post(
    '/facts/:id/confirm',
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: factActionResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      try {
        const row = await confirmFact(app.db, userId, request.params.id);
        const entityInfo = await attachEntityInfo(app.db, userId, [row]);
        return { fact: toFactDto(row, entityInfo) };
      } catch (err) {
        const handled = handlePersonalModelError(err);
        reply.code(handled.statusCode);
        return handled.body;
      }
    },
  );

  server.post(
    '/facts/:id/correct',
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: correctFactRequestSchema,
        response: { 200: factActionResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      try {
        const row = await correctFact(app.db, userId, request.params.id, request.body.correctedText);
        const entityInfo = await attachEntityInfo(app.db, userId, [row]);
        return { fact: toFactDto(row, entityInfo) };
      } catch (err) {
        const handled = handlePersonalModelError(err);
        reply.code(handled.statusCode);
        return handled.body;
      }
    },
  );

  server.post(
    '/facts/:id/dismiss',
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: factActionResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      try {
        const row = await dismissFact(app.db, userId, request.params.id);
        const entityInfo = await attachEntityInfo(app.db, userId, [row]);
        return { fact: toFactDto(row, entityInfo) };
      } catch (err) {
        const handled = handlePersonalModelError(err);
        reply.code(handled.statusCode);
        return handled.body;
      }
    },
  );
}
