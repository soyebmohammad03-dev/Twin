import { z } from 'zod';
import { entityDtoSchema, entitySubtypeSchema, epistemicStatusSchema, memoryDetailDtoSchema } from './memory.js';

/**
 * Contracts for Phase 7's knowledge graph API
 * (apps/api/src/modules/graph). Deliberately does not expose internal
 * database details — no raw SQL, no drizzle row shapes — only the
 * entity/relationship/evidence DTOs already used elsewhere plus the
 * graph-specific wrapper shapes below.
 */

export const entityRelationshipDtoSchema = z.object({
  id: z.string().uuid(),
  fromEntityId: z.string().uuid(),
  toEntityId: z.string().uuid(),
  relationshipType: z.string(),
  epistemicStatus: epistemicStatusSchema,
  confidence: z.number().min(0).max(1),
  extractionMethod: z.string(),
  sourceMemoryId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EntityRelationshipDto = z.infer<typeof entityRelationshipDtoSchema>;

export const connectedRelationshipDtoSchema = z.object({
  relationship: entityRelationshipDtoSchema,
  connectedEntity: entityDtoSchema,
  direction: z.enum(['outgoing', 'incoming']),
});
export type ConnectedRelationshipDto = z.infer<typeof connectedRelationshipDtoSchema>;

export const entityDetailResponseSchema = z.object({
  entity: entityDtoSchema,
  /** Phase 40: the entity's real subtype data (project/goal/event/person/decision), when present — null for 'idea' or when no subtype row exists yet. */
  subtype: entitySubtypeSchema.nullable(),
  relationships: z.array(connectedRelationshipDtoSchema),
  supportingMemories: z.array(memoryDetailDtoSchema),
});
export type EntityDetailResponse = z.infer<typeof entityDetailResponseSchema>;

export const traversalNodeDtoSchema = z.object({
  entity: entityDtoSchema,
  hopDistance: z.number().int().min(1),
  viaRelationship: z
    .object({
      id: z.string().uuid(),
      relationshipType: z.string(),
      direction: z.enum(['outgoing', 'incoming']),
      fromEntityId: z.string().uuid(),
      toEntityId: z.string().uuid(),
    })
    .nullable(),
});
export type TraversalNodeDto = z.infer<typeof traversalNodeDtoSchema>;

export const traverseQuerySchema = z.object({
  hops: z.coerce.number().int().min(1).max(2).default(1),
  includeArchived: z.coerce.boolean().default(false),
});
export type TraverseQuery = z.infer<typeof traverseQuerySchema>;

export const relatedEntitiesResponseSchema = z.object({
  entity: entityDtoSchema,
  nodes: z.array(traversalNodeDtoSchema),
});
export type RelatedEntitiesResponse = z.infer<typeof relatedEntitiesResponseSchema>;

/**
 * One piece of evidence behind a relationship — the concrete answer to
 * "why do you think X is connected to Y". `memory` is null only if the
 * originating memory was later hard-deleted (soft-archived memories
 * still appear here, since evidence is preserved regardless).
 */
export const relationshipEvidenceDtoSchema = z.object({
  id: z.string().uuid(),
  relationshipId: z.string().uuid(),
  memoryId: z.string().uuid(),
  epistemicStatus: epistemicStatusSchema,
  confidence: z.number().min(0).max(1),
  extractionMethod: z.string(),
  evidenceText: z.string().nullable(),
  createdAt: z.string(),
  memory: memoryDetailDtoSchema.nullable(),
});
export type RelationshipEvidenceDto = z.infer<typeof relationshipEvidenceDtoSchema>;

export const relationshipEvidenceResponseSchema = z.object({
  relationship: entityRelationshipDtoSchema,
  fromEntity: entityDtoSchema,
  toEntity: entityDtoSchema,
  evidence: z.array(relationshipEvidenceDtoSchema),
});
export type RelationshipEvidenceResponse = z.infer<typeof relationshipEvidenceResponseSchema>;

/**
 * Phase 27: a user directly declaring a relationship between two of
 * their own EXISTING entities — never creates a third "ghost" entity.
 * relationshipType stays open-vocabulary (free text), matching the
 * existing entity_relationships.relationship_type convention — no new
 * enum. The focus entity (the one whose detail view this was opened
 * from) is always fromEntityId; toEntityId is the entity being
 * connected to. No confidence/date/direction fields are exposed here —
 * a user-declared relationship is always epistemicStatus='explicit',
 * confidence=1.00 (set server-side), matching how an explicit memory
 * statement is treated elsewhere.
 */
export const createRelationshipRequestSchema = z.object({
  toEntityId: z.string().uuid(),
  relationshipType: z
    .string()
    .trim()
    .min(1, 'relationshipType must not be empty')
    .max(100)
    .regex(/^[a-z0-9_]+$/, 'relationshipType must be snake_case (lowercase letters, digits, underscores)'),
});
export type CreateRelationshipRequest = z.infer<typeof createRelationshipRequestSchema>;
