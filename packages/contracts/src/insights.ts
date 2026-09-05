import { z } from 'zod';
import { entityTypeSchema, memoryDetailDtoSchema } from './memory.js';
import { personalModelFactDtoSchema } from './personalModel.js';

/**
 * Contracts for Phase 10's Insight layer
 * (apps/api/src/modules/insights). An Insight is a structured,
 * evidence-backed observation about a PATTERN across existing
 * memories/entities/relationships/Personal Model facts — a separate
 * epistemic layer from personal_model_facts (@see personalModel.ts).
 * An insight is never written into personal_model_facts and vice
 * versa; it can only be accepted (left as-is) or dismissed, never
 * "corrected" into a new fact.
 */

/**
 * The insight types this phase actually derives from grounded data.
 * Open, evolving taxonomy (matches personalModelCategorySchema's
 * convention) — Phase 10 emitted only 'neglected_goal'; Phase 11 adds
 * 'recurring_topic' (derived from Personal Model's own recurring_topics
 * category) and 'priority_tension' (derived from co-existing like:/
 * dislike: preference facts). Phase 12 adds 'relationship_tension'
 * (the same entity holding more than one current relationship of the
 * same type, pointing at different targets — reuses
 * personalModel/conflicts.ts's detectRelationshipConflicts). More
 * types are added the same way, as a contract-only change with no
 * schema migration. Phase 14 adds 'cross_insight' — a higher-order
 * pattern synthesized from >=2 of the FIRST-ORDER types above sharing
 * a concrete anchor (the same entity, or the same normalized
 * preference subject bridged to an entity name). Never synthesized
 * from another cross_insight — first-order sources only, by
 * construction (see insightsEngine.ts's computeCrossInsightInsights).
 */
export const insightTypeSchema = z.enum([
  'neglected_goal',
  'recurring_topic',
  'priority_tension',
  'relationship_tension',
  'cross_insight',
  'decision_evolution',
  'goal_target_approaching',
]);
export type InsightType = z.infer<typeof insightTypeSchema>;

/**
 * How Twin arrived at this insight — deliberately distinct from
 * epistemicStatus (which describes a single piece of evidence).
 * 'observed': directly checkable from explicit-tier evidence, no
 *   inference step (e.g. a frequency count).
 * 'inferred': requires connecting multiple evidence items through
 *   structure (graph traversal, cross-referencing facts).
 * 'hypothesis': the deterministic signal is present but weak — right
 *   at threshold, or built from lower-confidence evidence.
 * 'tension': two currently-held beliefs appear to conflict — a
 *   distinct epistemic shape from a single accumulating pattern
 *   (Phase 11), never merely a low-confidence 'hypothesis'.
 * 'unresolved': the insight IS an open question/absence, not a claim
 *   to confirm (e.g. a neglected goal, a knowledge gap).
 */
export const insightStatusClassSchema = z.enum(['observed', 'inferred', 'hypothesis', 'tension', 'unresolved']);
export type InsightStatusClass = z.infer<typeof insightStatusClassSchema>;

/**
 * A pattern's lifecycle stage — distinct from personal_model_facts'
 * temporalState, which describes a single fact's currency, not a
 * pattern's trajectory over time. See modules/insights/temporal.ts.
 */
export const insightTemporalStateSchema = z.enum(['emerging', 'recurring', 'stable', 'fading', 'superseded', 'unresolved']);
export type InsightTemporalState = z.infer<typeof insightTemporalStateSchema>;

/** 'insight' (Phase 14) points at a CONTRIBUTING first-order insight a cross_insight synthesizes — see insightEvidenceDtoSchema's sourceInsightId. */
export const insightEvidenceTypeSchema = z.enum(['memory', 'entity', 'relationship', 'personal_model_fact', 'insight', 'decision_history']);
export type InsightEvidenceType = z.infer<typeof insightEvidenceTypeSchema>;

export const insightDtoSchema = z.object({
  id: z.string().uuid(),
  insightType: insightTypeSchema,
  subjectKey: z.string(),
  statusClass: insightStatusClassSchema,
  temporalState: insightTemporalStateSchema,
  title: z.string(),
  description: z.string(),
  confidence: z.number().min(0).max(1),
  subjectEntityId: z.string().uuid().nullable(),
  subjectEntityName: z.string().nullable(),
  subjectEntityType: entityTypeSchema.nullable(),
  firstObservedAt: z.string(),
  lastObservedAt: z.string(),
  observationCount: z.number().int().min(1),
  dismissedAt: z.string().nullable(),
  supersededByInsightId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type InsightDto = z.infer<typeof insightDtoSchema>;

/**
 * The Insight layer as returned to a client: current (non-dismissed)
 * insights. Deliberately has no "uncertainCount" cross-cut the way
 * the Personal Model does — every insight already carries its own
 * statusClass, which is the honesty signal here.
 */
export const insightsResponseSchema = z.object({
  insights: z.array(insightDtoSchema),
  generatedAt: z.string(),
});
export type InsightsResponse = z.infer<typeof insightsResponseSchema>;

export const insightEvidenceDtoSchema = z.object({
  id: z.string().uuid(),
  insightId: z.string().uuid(),
  evidenceType: insightEvidenceTypeSchema,
  memoryId: z.string().uuid().nullable(),
  entityId: z.string().uuid().nullable(),
  relationshipId: z.string().uuid().nullable(),
  personalModelFactId: z.string().uuid().nullable(),
  sourceInsightId: z.string().uuid().nullable(),
  decisionHistoryId: z.string().uuid().nullable(),
  evidenceText: z.string().nullable(),
  observedAt: z.string(),
  createdAt: z.string(),
  supersededAt: z.string().nullable(),
  memory: memoryDetailDtoSchema.nullable(),
});
export type InsightEvidenceDto = z.infer<typeof insightEvidenceDtoSchema>;

export const insightEvidenceResponseSchema = z.object({
  insight: insightDtoSchema,
  evidence: z.array(insightEvidenceDtoSchema),
});
export type InsightEvidenceResponse = z.infer<typeof insightEvidenceResponseSchema>;

export const rebuildInsightsResponseSchema = z.object({
  insightCount: z.number().int().min(0),
  generatedAt: z.string(),
});
export type RebuildInsightsResponse = z.infer<typeof rebuildInsightsResponseSchema>;

/**
 * Phase 16's "Context" view: how a surfaced insight connects to the
 * user's Personal Model. Never a new reasoning layer — both arrays are
 * plain lookups over already-stored data:
 *
 *   directFacts  — Personal Model facts already cited as
 *                  'personal_model_fact' evidence FOR this specific
 *                  insight (recurring_topic/priority_tension only,
 *                  today). The strongest connection: Twin explicitly
 *                  used this fact to derive the insight.
 *   relatedFacts — other CURRENT (not dismissed, not
 *                  outdated/superseded) facts that merely share the
 *                  insight's subjectEntityId — a real, inspectable
 *                  structural connection, but one Twin did NOT cite
 *                  when generating the insight. Weaker than
 *                  directFacts; the frontend must label it as such,
 *                  never as confirmed support.
 *
 * Both empty is a legitimate, honestly-reported outcome ("Twin doesn't
 * have Personal Model context for this yet") — never backfilled with
 * an invented connection.
 */
export const insightContextResponseSchema = z.object({
  insight: insightDtoSchema,
  directFacts: z.array(personalModelFactDtoSchema),
  relatedFacts: z.array(personalModelFactDtoSchema),
});
export type InsightContextResponse = z.infer<typeof insightContextResponseSchema>;
