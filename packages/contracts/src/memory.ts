import { z } from 'zod';

/**
 * Contracts for Twin's memory foundation (packages/db/src/schema:
 * entities, sources, memories, memory_entities, entity_relationships)
 * and the memory API built on top of it in Phase 3
 * (apps/api/src/modules/memories, apps/api/src/modules/entities).
 *
 * Deliberately excluded from every DTO: the `embedding` column. It's
 * an internal representation for retrieval, not something a client
 * reads or writes directly — and nothing generates it yet.
 */

export const entityTypeSchema = z.enum(['person', 'project', 'goal', 'decision', 'idea', 'event']);
export type EntityType = z.infer<typeof entityTypeSchema>;

export const epistemicStatusSchema = z.enum([
  'explicit',
  'from_source',
  'reported_by_other',
  'inferred',
  'probable',
]);
export type EpistemicStatus = z.infer<typeof epistemicStatusSchema>;

export const sourceTypeSchema = z.enum([
  'manual',
  'voice_note',
  'document',
  'image',
  'screen_capture',
  'conversation',
  'web_link',
  'system_synthesis',
]);
export type SourceType = z.infer<typeof sourceTypeSchema>;

// --- Response DTOs ---

export const sourceDtoSchema = z.object({
  id: z.string().uuid(),
  sourceType: sourceTypeSchema,
  title: z.string().nullable(),
  rawContent: z.string().nullable(),
  url: z.string().nullable(),
  capturedAt: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type SourceDto = z.infer<typeof sourceDtoSchema>;

export const memoryDtoSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  memoryType: z.string(),
  content: z.string(),
  epistemicStatus: epistemicStatusSchema,
  confidence: z.number().min(0).max(1),
  importance: z.number().int().min(1).max(5),
  occurredAt: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MemoryDto = z.infer<typeof memoryDtoSchema>;

export const entityDtoSchema = z.object({
  id: z.string().uuid(),
  entityType: entityTypeSchema,
  name: z.string(),
  description: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EntityDto = z.infer<typeof entityDtoSchema>;

export const memoryEntityLinkDtoSchema = z.object({
  id: z.string().uuid(),
  memoryId: z.string().uuid(),
  entityId: z.string().uuid(),
  role: z.string(),
  createdAt: z.string(),
});
export type MemoryEntityLinkDto = z.infer<typeof memoryEntityLinkDtoSchema>;

/** A memory-entity link with the linked entity embedded, for detail/list views. */
export const memoryEntityLinkWithEntitySchema = memoryEntityLinkDtoSchema.extend({
  entity: entityDtoSchema,
});
export type MemoryEntityLinkWithEntity = z.infer<typeof memoryEntityLinkWithEntitySchema>;

/** A memory with its source and linked entities embedded — used for both the list and detail endpoints. */
export const memoryDetailDtoSchema = memoryDtoSchema.extend({
  source: sourceDtoSchema,
  entityLinks: z.array(memoryEntityLinkWithEntitySchema),
});
export type MemoryDetailDto = z.infer<typeof memoryDetailDtoSchema>;

// entityRelationshipDtoSchema moved to graph.ts in Phase 7, once a
// real endpoint (modules/graph) started actually returning it — this
// Phase 2 placeholder never matched what got built (no epistemicStatus,
// extractionMethod, or sourceMemoryId) and nothing referenced it.

// --- Create-request shapes ---
// No endpoint validates against these yet; they exist so the future
// memory API module has a contract to implement against rather than
// improvising one.

export const createSourceRequestSchema = z.object({
  sourceType: sourceTypeSchema,
  title: z.string().trim().max(200).optional(),
  rawContent: z.string().optional(),
  url: z.string().url().optional(),
  capturedAt: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateSourceRequest = z.infer<typeof createSourceRequestSchema>;

/** Describes a new source to create in the same request as the memory (see createMemoryRequestSchema). */
export const inlineSourceInputSchema = z.object({
  sourceType: sourceTypeSchema,
  title: z.string().trim().max(200).optional(),
  rawContent: z.string().optional(),
  url: z.string().url().optional(),
  capturedAt: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type InlineSourceInput = z.infer<typeof inlineSourceInputSchema>;

export const memoryEntityLinkInputSchema = z.object({
  entityId: z.string().uuid(),
  role: z.string().trim().min(1).max(64).optional(),
});
export type MemoryEntityLinkInput = z.infer<typeof memoryEntityLinkInputSchema>;

export const createMemoryRequestSchema = z
  .object({
    // Provenance: reference an existing source, or describe a new one
    // to be created in the same transaction. Exactly one is required.
    sourceId: z.string().uuid().optional(),
    source: inlineSourceInputSchema.optional(),
    memoryType: z.string().trim().min(1).max(64).default('note'),
    content: z.string().trim().min(1),
    epistemicStatus: epistemicStatusSchema.default('explicit'),
    confidence: z.number().min(0).max(1).default(1),
    importance: z.number().int().min(1).max(5).default(3),
    occurredAt: z.string().datetime().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    // Linked at creation time, in the same transaction as the memory.
    entityLinks: z.array(memoryEntityLinkInputSchema).optional(),
  })
  .refine((data) => Boolean(data.sourceId) !== Boolean(data.source), {
    message: 'Provide exactly one of sourceId or source.',
    path: ['sourceId'],
  });
export type CreateMemoryRequest = z.infer<typeof createMemoryRequestSchema>;

export const updateMemoryRequestSchema = z
  .object({
    content: z.string().trim().min(1).optional(),
    memoryType: z.string().trim().min(1).max(64).optional(),
    epistemicStatus: epistemicStatusSchema.optional(),
    confidence: z.number().min(0).max(1).optional(),
    importance: z.number().int().min(1).max(5).optional(),
    occurredAt: z.string().datetime().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Provide at least one field to update.' });
export type UpdateMemoryRequest = z.infer<typeof updateMemoryRequestSchema>;

export const linkMemoryEntityRequestSchema = z.object({
  entityId: z.string().uuid(),
  role: z.string().trim().min(1).max(64).optional(),
});
export type LinkMemoryEntityRequest = z.infer<typeof linkMemoryEntityRequestSchema>;

export const listMemoriesQuerySchema = z.object({
  memoryType: z.string().trim().min(1).max(64).optional(),
  includeArchived: z.coerce.boolean().optional().default(false),
});
export type ListMemoriesQuery = z.infer<typeof listMemoriesQuerySchema>;

export const createEntityRequestSchema = z.object({
  entityType: entityTypeSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateEntityRequest = z.infer<typeof createEntityRequestSchema>;

export const listEntitiesQuerySchema = z.object({
  entityType: entityTypeSchema.optional(),
  name: z.string().trim().min(1).max(200).optional(), // case-insensitive substring match
});
export type ListEntitiesQuery = z.infer<typeof listEntitiesQuerySchema>;

// createEntityRelationshipRequestSchema was removed in Phase 7 — never
// referenced anywhere; relationships are created exclusively through
// the extraction pipeline's provenance-tracked path
// (modules/graph/relationships.service.ts's upsertRelationshipWithEvidence),
// not a raw client-supplied "create a relationship" endpoint.
