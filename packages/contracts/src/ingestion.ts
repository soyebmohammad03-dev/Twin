import { z } from 'zod';
import { epistemicStatusSchema, memoryDetailDtoSchema } from './memory.js';

/**
 * Contracts for the ingestion pipeline (apps/api/src/modules/ingestion).
 * Ingestion is how raw input (text, a voice transcript, a web link, or
 * a manually-described image/document) becomes a memory — it's a
 * thin, honest layer on top of the Phase 3 memory API: it resolves
 * raw input into memory fields, checks for duplicates, does light
 * (non-AI) entity linking, then calls the same memory-creation path
 * everything else uses. See ingestion.service.ts for exactly what
 * happens per input type.
 */

export const ingestionInputTypeSchema = z.enum(['text', 'image', 'document', 'voice_transcript', 'web_link']);
export type IngestionInputType = z.infer<typeof ingestionInputTypeSchema>;

export const ingestionStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed']);
export type IngestionStatus = z.infer<typeof ingestionStatusSchema>;

const commonIngestionFieldsSchema = z.object({
  // A user-facing title, distinct from the content — stored in the
  // resulting memory's metadata.title (mirrors how the direct memory
  // API's callers already do this; see apps/web/src/services/memoryMapper.ts).
  title: z.string().trim().max(200).optional(),
  memoryType: z.string().trim().min(1).max(64).optional(),
  // Callers may override the epistemic default per type (see
  // ingestion.service.ts) — e.g. to mark something as told to the
  // user by someone else rather than experienced firsthand. The
  // pipeline itself never assigns 'inferred' or 'probable' — nothing
  // in this phase actually infers anything.
  epistemicStatus: epistemicStatusSchema.optional(),
  importance: z.number().int().min(1).max(5).optional(),
  occurredAt: z.string().datetime().optional(),
  tags: z.array(z.string().trim().min(1)).max(20).optional(),
});

export const createIngestionRequestSchema = z.discriminatedUnion('type', [
  commonIngestionFieldsSchema.extend({
    type: z.literal('text'),
    content: z.string().trim().min(1).max(20_000),
  }),
  commonIngestionFieldsSchema.extend({
    type: z.literal('voice_transcript'),
    // Assumes speech-to-text already happened — this pipeline does not
    // perform transcription itself.
    transcript: z.string().trim().min(1).max(20_000),
  }),
  commonIngestionFieldsSchema.extend({
    type: z.literal('web_link'),
    url: z.string().url(),
  }),
  commonIngestionFieldsSchema.extend({
    type: z.literal('image'),
    // No OCR is implemented — the caller describes what the image
    // shows, and that description is what gets stored as content.
    description: z.string().trim().min(1).max(20_000),
  }),
  commonIngestionFieldsSchema.extend({
    type: z.literal('document'),
    // No document parsing is implemented — same as image.
    description: z.string().trim().min(1).max(20_000),
  }),
]);
export type CreateIngestionRequest = z.infer<typeof createIngestionRequestSchema>;

export const ingestionStatusHistoryEntrySchema = z.object({
  status: ingestionStatusSchema,
  at: z.string(),
});
export type IngestionStatusHistoryEntry = z.infer<typeof ingestionStatusHistoryEntrySchema>;

/**
 * Audit trail for the optional Phase 5 AI extraction stage. Null when
 * no AI provider is configured (EXTRACTION_PROVIDER=heuristic, the
 * default) — distinct from a 'completed' result that simply found
 * nothing to extract. Kept as a loosely-typed record rather than a
 * fully-modeled DTO: this is an internal audit/debug surface, not
 * something the UI renders yet, so the exact shape is free to evolve
 * with the pipeline (apps/api/src/modules/ingestion/ingestion.service.ts's
 * AIExtractionAudit) without a contracts-package version bump.
 */
export const extractionResultDtoSchema = z
  .object({
    status: z.enum(['completed', 'failed']),
    provider: z.string(),
  })
  .and(z.record(z.string(), z.unknown()))
  .nullable();
export type ExtractionResultDto = z.infer<typeof extractionResultDtoSchema>;

export const ingestionJobDtoSchema = z.object({
  id: z.string().uuid(),
  inputType: ingestionInputTypeSchema,
  status: ingestionStatusSchema,
  statusHistory: z.array(ingestionStatusHistoryEntrySchema),
  extractionProvider: z.string(),
  extractionResult: extractionResultDtoSchema,
  isDuplicate: z.boolean(),
  resultMemoryId: z.string().uuid().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
});
export type IngestionJobDto = z.infer<typeof ingestionJobDtoSchema>;

/** POST /ingestion and GET /ingestion/:id both return this shape — the job plus whatever memory it produced (null only when status is 'failed'). */
export const ingestionResultDtoSchema = z.object({
  job: ingestionJobDtoSchema,
  memory: memoryDetailDtoSchema.nullable(),
});
export type IngestionResultDto = z.infer<typeof ingestionResultDtoSchema>;

export const listIngestionJobsQuerySchema = z.object({
  status: ingestionStatusSchema.optional(),
});
export type ListIngestionJobsQuery = z.infer<typeof listIngestionJobsQuerySchema>;
