import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createIngestionRequestSchema,
  listIngestionJobsQuerySchema,
  ingestionJobDtoSchema,
  ingestionResultDtoSchema,
  errorResponseSchema,
  type IngestionJobDto,
  type IngestionResultDto,
} from '@twin/contracts';
import { authenticate, getAuthenticatedUserId } from '../../plugins/authenticate.js';
import { ingest, getIngestionJob, listIngestionJobs, type IngestionJobRow, type IngestionResult } from './ingestion.service.js';
import { toMemoryDetailDto } from '../memories/memories.routes.js';

function toIngestionJobDto(row: IngestionJobRow): IngestionJobDto {
  return {
    id: row.id,
    inputType: row.inputType,
    status: row.status,
    statusHistory: row.statusHistory as IngestionJobDto['statusHistory'],
    extractionProvider: row.extractionProvider,
    extractionResult: row.extractionResult as IngestionJobDto['extractionResult'],
    isDuplicate: row.isDuplicate,
    resultMemoryId: row.resultMemoryId,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function toIngestionResultDto(result: IngestionResult): IngestionResultDto {
  return {
    job: toIngestionJobDto(result.job),
    memory: result.memory ? toMemoryDetailDto(result.memory) : null,
  };
}

export async function registerIngestionRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/',
    {
      preHandler: authenticate,
      schema: {
        body: createIngestionRequestSchema,
        response: { 201: ingestionResultDtoSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      const result = await ingest(app.db, userId, request.body);
      reply.code(201);
      return toIngestionResultDto(result);
    },
  );

  server.get(
    '/',
    {
      preHandler: authenticate,
      schema: {
        querystring: listIngestionJobsQuerySchema,
        response: { 200: z.array(ingestionJobDtoSchema), 401: errorResponseSchema },
      },
    },
    async (request) => {
      const userId = getAuthenticatedUserId(request);
      const rows = await listIngestionJobs(app.db, userId, request.query);
      return rows.map(toIngestionJobDto);
    },
  );

  server.get(
    '/:id',
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: ingestionResultDtoSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const userId = getAuthenticatedUserId(request);
      const result = await getIngestionJob(app.db, userId, request.params.id);
      if (!result) {
        reply.code(404);
        return { error: 'not_found', message: 'Ingestion job not found.' };
      }
      return toIngestionResultDto(result);
    },
  );
}
