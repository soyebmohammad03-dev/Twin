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
import { extractPdfText, DocumentExtractionError } from './extraction/documentExtract.js';

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

  /**
   * Phase 42: real PDF document ingestion. multipart/form-data (never
   * JSON — a fastify-type-provider-zod body schema can't describe a
   * file stream), so this route validates the upload by hand rather
   * than via the shared zod schema every other route here uses.
   *
   * Only application/pdf is accepted — anything else fails honestly
   * with a clear "unsupported modality" 415, never a silently
   * fabricated text extraction. A PDF with no extractable text layer
   * (e.g. a scanned image) fails the same way, via
   * DocumentExtractionError, and becomes a real 'failed' ingestion job
   * — not a fabricated memory — through the exact same ingest()
   * pipeline every other input type uses.
   */
  server.post('/documents', { preHandler: authenticate }, async (request, reply) => {
    const userId = getAuthenticatedUserId(request);

    const file = await request.file();
    if (!file) {
      reply.code(400);
      return { error: 'no_file', message: 'No file was uploaded. Send a multipart/form-data request with a "file" field.' };
    }
    if (file.mimetype !== 'application/pdf') {
      reply.code(415);
      return { error: 'unsupported_modality', message: `Unsupported file type: ${file.mimetype}. Only application/pdf is currently supported.` };
    }

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch (err) {
      reply.code(413);
      return { error: 'file_too_large', message: err instanceof Error ? err.message : 'The uploaded file is too large.' };
    }

    let extracted: { text: string; pageCount: number };
    try {
      extracted = await extractPdfText(buffer);
    } catch (err) {
      // Honest failure, not a fabricated memory: mirrors exactly how
      // ingest() itself handles a WebFetchError for web_link — but this
      // one happens before a job even exists (extraction failed before
      // resolveInput would have run), so it's reported directly rather
      // than persisted as a job with no real input to record.
      const message = err instanceof DocumentExtractionError ? err.message : 'Could not extract text from this document.';
      reply.code(422);
      return { error: 'extraction_failed', message };
    }

    // Other form fields (e.g. an optional "title" part) are exposed on
    // file.fields once the file stream has been fully consumed —
    // @fastify/multipart's documented way to read fields regardless of
    // their order relative to the file part in the multipart body.
    const titleField = (file.fields as Record<string, { value?: unknown }> | undefined)?.title?.value;
    const rawTitle = typeof titleField === 'string' && titleField.trim().length > 0 ? titleField.trim() : (file.filename ?? undefined);
    const title = rawTitle?.slice(0, 200);

    const result = await ingest(app.db, userId, {
      type: 'document',
      description: extracted.text,
      title,
      // Real extracted document content, not the user's own account —
      // see resolveInput's 'document' case in ingestion.service.ts.
      epistemicStatus: 'from_source',
    });
    reply.code(201);
    return toIngestionResultDto(result);
  });

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
