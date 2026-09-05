import { z } from 'zod';
import { entityDtoSchema, memoryDetailDtoSchema } from './memory.js';
import { connectedRelationshipDtoSchema } from './graph.js';

/**
 * Phase 25's Decision Intelligence foundation.
 *
 * Deliberately reuses the existing schema as-is — no migration. The
 * `decisions` table (packages/db/src/schema/decisions.ts) already has
 * status/outcome/decidedAt; before this phase nothing ever wrote to
 * it, so every decision entity was a bare `entities` row with no
 * subtype data. This is the first code that actually populates and
 * reads it.
 *
 * Alternatives/criteria/tradeoffs are deliberately NOT new columns —
 * they're represented (when a caller records them) via the existing
 * open-vocabulary `memory_entities.role` and
 * `entity_relationships.relationship_type` fields, exactly like every
 * other entity type. Nothing in this phase invents fake pros/cons,
 * weighted scores, or auto-detected alternatives.
 */

export const decisionStatusSchema = z.enum(['open', 'decided', 'reversed']);
export type DecisionStatus = z.infer<typeof decisionStatusSchema>;

/** The decision subtype's own fields, without the shared entity fields. */
export const decisionSubtypeSchema = z.object({
  status: decisionStatusSchema,
  outcome: z.string().nullable(),
  decidedAt: z.string().nullable(),
});
export type DecisionSubtype = z.infer<typeof decisionSubtypeSchema>;

/** A decision entity with its subtype fields merged in — the shape every decision list/detail response uses. */
export const decisionDtoSchema = entityDtoSchema.extend({
  status: decisionStatusSchema,
  outcome: z.string().nullable(),
  decidedAt: z.string().nullable(),
  /**
   * Phase 26: whether this decision has ANY recorded evidence — a
   * graph relationship or a linked supporting memory. Computed from
   * real rows (see decisions.service.ts's hasEvidenceForDecision), never
   * a fabricated count — lets the list screen show "no evidence linked
   * yet" without an N+1 fetch per row.
   */
  hasEvidence: z.boolean(),
});
export type DecisionDto = z.infer<typeof decisionDtoSchema>;

/**
 * Phase 26: status/outcome/decidedAt are optional at creation so a user
 * recording a decision they already made (not one still open) can do it
 * in one step — e.g. "Accepted the offer", status decided, dated today
 * — rather than create-then-immediately-patch. Omitting them keeps
 * Phase 25's original behavior: a fresh 'open' decision with no outcome.
 */
export const createDecisionRequestSchema = z.object({
  name: z.string().trim().min(1, 'name must not be empty').max(500),
  description: z.string().trim().max(5000).optional(),
  status: decisionStatusSchema.optional(),
  outcome: z.string().trim().max(2000).optional(),
  decidedAt: z.string().datetime().optional(),
});
export type CreateDecisionRequest = z.infer<typeof createDecisionRequestSchema>;

/**
 * Every field optional (patch semantics) — a caller updates only what
 * they explicitly know. `outcome`/`decidedAt` accept `null` to
 * explicitly clear a previously-recorded value (e.g. reopening a
 * decision), distinct from omitting the field (leave unchanged).
 */
export const updateDecisionRequestSchema = z
  .object({
    status: decisionStatusSchema.optional(),
    outcome: z.string().trim().max(2000).nullable().optional(),
    decidedAt: z.string().datetime().nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.outcome !== undefined || v.decidedAt !== undefined, {
    message: 'At least one field must be provided.',
  });
export type UpdateDecisionRequest = z.infer<typeof updateDecisionRequestSchema>;

export const listDecisionsResponseSchema = z.array(decisionDtoSchema);
export type ListDecisionsResponse = z.infer<typeof listDecisionsResponseSchema>;

/**
 * Deterministic KNOWN/UNKNOWN classification of a decision's current
 * structured state — never an LLM call, a pure function of the rows
 * already fetched (see apps/api/src/modules/decisions/decisionContext.ts).
 * Distinct from the free-text grounded "why" explanation, which reuses
 * the existing POST /reason endpoint instead of a second reasoning path.
 */
export const decisionContextSchema = z.object({
  known: z.array(z.string()),
  unknown: z.array(z.string()),
  hasEvidence: z.boolean(),
});
export type DecisionContext = z.infer<typeof decisionContextSchema>;

/**
 * Full decision detail: the decision itself, its graph relationships
 * and supporting memories (identical shape to, and produced by, the
 * same graph.service.getEntityDetail every other entity type uses —
 * no parallel retrieval path), plus the deterministic context summary.
 */
export const decisionDetailResponseSchema = z.object({
  decision: decisionDtoSchema,
  relationships: z.array(connectedRelationshipDtoSchema),
  supportingMemories: z.array(memoryDetailDtoSchema),
  context: decisionContextSchema,
});
export type DecisionDetailResponse = z.infer<typeof decisionDetailResponseSchema>;

/**
 * Phase 36 — one real, immutable record of a status/outcome/decidedAt
 * transition (packages/db/src/schema/decisionHistory.ts), written only
 * when decisions.service.ts's updateDecision detects an actual change.
 * This is what makes "how did this decision change over time?"
 * answerable at all — the `decisions` table itself only ever holds the
 * CURRENT state. Every field here is a fact about what the user
 * genuinely did, never an inference: reversing a decision or editing
 * its outcome previously discarded the prior value with no trace.
 */
export const decisionHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  previousStatus: decisionStatusSchema,
  newStatus: decisionStatusSchema,
  previousOutcome: z.string().nullable(),
  newOutcome: z.string().nullable(),
  previousDecidedAt: z.string().nullable(),
  newDecidedAt: z.string().nullable(),
  changedAt: z.string(),
});
export type DecisionHistoryEntry = z.infer<typeof decisionHistoryEntrySchema>;

/** Oldest first — a real timeline reads top-to-bottom as "what happened, in order," not newest-first like an activity feed. */
export const listDecisionHistoryResponseSchema = z.array(decisionHistoryEntrySchema);
export type ListDecisionHistoryResponse = z.infer<typeof listDecisionHistoryResponseSchema>;
