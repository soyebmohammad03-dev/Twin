import { z } from 'zod';
import { epistemicStatusSchema, entityTypeSchema, memoryDetailDtoSchema } from './memory.js';

/**
 * Contracts for Phase 9's Personal Model
 * (apps/api/src/modules/personalModel). A ModelFact is a structured,
 * evidence-backed claim about the user — never a free-text blob, never
 * a copy of the underlying memories. Deliberately excludes anything
 * resembling "pretend you are the user" — this describes what Twin
 * knows/infers, not a persona to perform.
 */

/**
 * The categories this phase actually derives from grounded data (see
 * modules/personalModel/categories.ts, the single source of truth this
 * must match). Two categories described in the product brief
 * (communication_tendencies, working_context) are intentionally
 * excluded here — nothing in the current schema grounds them yet;
 * adding fabricated heuristics for ungrounded categories would produce
 * confident-looking nonsense, which the Personal Model must never do.
 */
export const personalModelCategorySchema = z.enum([
  'important_people',
  'active_projects',
  'goals',
  'decisions',
  'knowledge_areas',
  'recurring_topics',
  'preferences',
  'constraints',
  'current_priorities',
]);
export type PersonalModelCategory = z.infer<typeof personalModelCategorySchema>;

/** How many independent observations support a fact, and whether they agree — see modules/personalModel/stability.ts. */
export const factStabilitySchema = z.enum(['one_off', 'stable', 'changing']);
export type FactStability = z.infer<typeof factStabilitySchema>;

/**
 * Where a fact's evidence currently sits relative to now — see
 * modules/personalModel/temporal.ts. 'unresolved' is reserved for
 * future use; this phase's deterministic generator never emits it.
 * 'outdated' (Phase 9.1) marks a fact whose claim was explicitly
 * contradicted by the user via correction with no stated replacement —
 * distinct from 'superseded', which means a specific newer fact (either
 * another correction or a structurally-detected conflict) took its
 * place.
 */
export const factTemporalStateSchema = z.enum(['current', 'historical', 'superseded', 'outdated', 'unresolved']);
export type FactTemporalState = z.infer<typeof factTemporalStateSchema>;

export const evidenceSourceSchema = z.enum([
  'memory',
  'relationship',
  'user_confirmation',
  'user_correction',
  'user_dismissal',
]);
export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;

export const personalModelFactDtoSchema = z.object({
  id: z.string().uuid(),
  category: personalModelCategorySchema,
  subjectKey: z.string(),
  subjectEntityId: z.string().uuid().nullable(),
  subjectEntityName: z.string().nullable(),
  subjectEntityType: entityTypeSchema.nullable(),
  factText: z.string(),
  epistemicStatus: epistemicStatusSchema,
  confidence: z.number().min(0).max(1),
  stability: factStabilitySchema,
  temporalState: factTemporalStateSchema,
  firstObservedAt: z.string(),
  lastObservedAt: z.string(),
  observationCount: z.number().int().min(1),
  dismissedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PersonalModelFactDto = z.infer<typeof personalModelFactDtoSchema>;

/**
 * The Personal Model as returned to a client: current (non-dismissed)
 * facts grouped implicitly by `category`, plus a cross-cutting
 * `uncertain` list (facts whose epistemicStatus/confidence mark them
 * as needing confirmation) — computed as a filter over the same facts,
 * not a separately-derived category.
 */
export const personalModelResponseSchema = z.object({
  facts: z.array(personalModelFactDtoSchema),
  uncertainFactIds: z.array(z.string().uuid()),
  generatedAt: z.string(),
  /** Null until the first rebuild has ever run for this user. */
  snapshotVersion: z.number().int().min(1).nullable(),
});
export type PersonalModelResponse = z.infer<typeof personalModelResponseSchema>;

export const personalModelFactEvidenceDtoSchema = z.object({
  id: z.string().uuid(),
  factId: z.string().uuid(),
  evidenceSource: evidenceSourceSchema,
  memoryId: z.string().uuid().nullable(),
  relationshipId: z.string().uuid().nullable(),
  entityId: z.string().uuid().nullable(),
  epistemicStatus: epistemicStatusSchema,
  confidence: z.number().min(0).max(1),
  evidenceText: z.string().nullable(),
  observedAt: z.string(),
  createdAt: z.string(),
  /** Phase 9.1: set when a later correction explicitly contradicted or weakened the claim this evidence supported. Null = still live/current. Never deleted — history stays inspectable either way. */
  supersededAt: z.string().nullable(),
  memory: memoryDetailDtoSchema.nullable(),
});
export type PersonalModelFactEvidenceDto = z.infer<typeof personalModelFactEvidenceDtoSchema>;

export const factEvidenceResponseSchema = z.object({
  fact: personalModelFactDtoSchema,
  evidence: z.array(personalModelFactEvidenceDtoSchema),
});
export type FactEvidenceResponse = z.infer<typeof factEvidenceResponseSchema>;

export const personalModelChangeDtoSchema = z.object({
  id: z.string().uuid(),
  factId: z.string().uuid().nullable(),
  changeType: z.string(),
  description: z.string(),
  evidenceMemoryIds: z.array(z.string().uuid()),
  createdAt: z.string(),
});
export type PersonalModelChangeDto = z.infer<typeof personalModelChangeDtoSchema>;

export const modelChangesResponseSchema = z.object({
  changes: z.array(personalModelChangeDtoSchema),
});
export type ModelChangesResponse = z.infer<typeof modelChangesResponseSchema>;

export const rebuildModelResponseSchema = z.object({
  snapshotVersion: z.number().int().min(1),
  factCount: z.number().int().min(0),
  changes: z.array(personalModelChangeDtoSchema),
  generatedAt: z.string(),
});
export type RebuildModelResponse = z.infer<typeof rebuildModelResponseSchema>;

export const correctFactRequestSchema = z.object({
  correctedText: z.string().trim().min(1).max(500),
});
export type CorrectFactRequest = z.infer<typeof correctFactRequestSchema>;
