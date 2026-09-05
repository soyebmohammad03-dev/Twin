import { z } from 'zod';
import { entityTypeSchema, epistemicStatusSchema, sourceTypeSchema } from './memory.js';
import { rankingSignalsDtoSchema } from './retrieval.js';
import { personalModelCategorySchema, factTemporalStateSchema } from './personalModel.js';
import { insightTypeSchema, insightStatusClassSchema, insightTemporalStateSchema } from './insights.js';

/**
 * Contracts for Phase 8's Context Engine
 * (apps/api/src/modules/context). The ContextPacket is a new internal
 * contract meant to be the ONLY thing a future reasoning layer (Twin
 * Chat, insights, planning) ever receives — never a raw dump of the
 * user's memory database. It intentionally stays compact: memory
 * content can be truncated (see `contentTruncated`), and every array is
 * bounded by `budget` with truncation explicitly recorded rather than
 * silently omitted.
 */

/** Bumped to 2 in Phase 17: added `personalModelFacts`/`insights` sections and their budget/truncation fields — a breaking shape change for any consumer pattern-matching on packet contents, not merely additive. */
export const CONTEXT_PACKET_VERSION = 2 as const;

export const intentTypeSchema = z.enum([
  'factual_recall',
  'person_recall',
  'project_recall',
  'decision_recall',
  'timeline_recall',
  'comparison',
  'planning_context',
  'general_knowledge',
]);
export type IntentType = z.infer<typeof intentTypeSchema>;

/**
 * Deterministic, heuristic classification of evidence strength — a
 * function of (epistemicStatus, confidence), never of raw text. See
 * modules/context/epistemicTier.ts for the exact rule. Distinct from
 * `epistemicStatus` itself: this collapses the 5 statuses into 3 tiers
 * a reasoning layer can act on without re-deriving the rule itself.
 */
export const epistemicTierSchema = z.enum(['high', 'medium', 'low']);
export type EpistemicTier = z.infer<typeof epistemicTierSchema>;

// --- Request ---

export const contextBudgetSchema = z.object({
  maxMemories: z.number().int().min(1).max(50),
  maxEntities: z.number().int().min(1).max(50),
  maxRelationships: z.number().int().min(1).max(50),
  maxEvidencePerRelationship: z.number().int().min(1).max(20),
  maxContentCharsPerMemory: z.number().int().min(100).max(5000),
  /** Phase 17: bounds on the two new packet sections below — same "compact, bounded, truncation-recorded" discipline as every other budget field. */
  maxPersonalModelFacts: z.number().int().min(1).max(30),
  maxInsights: z.number().int().min(1).max(20),
});
export type ContextBudget = z.infer<typeof contextBudgetSchema>;

export const contextBudgetInputSchema = contextBudgetSchema.partial();
export type ContextBudgetInput = z.infer<typeof contextBudgetInputSchema>;

export const buildContextRequestSchema = z.object({
  query: z.string().trim().min(1, 'query must not be empty').max(2000, 'query is too long'),
  targetEntityId: z.string().uuid().optional(),
  personEntityId: z.string().uuid().optional(),
  projectEntityId: z.string().uuid().optional(),
  goalEntityId: z.string().uuid().optional(),
  decisionEntityId: z.string().uuid().optional(),
  occurredAfter: z.string().datetime().optional(),
  occurredBefore: z.string().datetime().optional(),
  /** 1 or 2 — bounded by Phase 7's MAX_TRAVERSAL_HOPS regardless of what's requested here. */
  graphHops: z.union([z.literal(1), z.literal(2)]).default(2),
  budget: contextBudgetInputSchema.optional(),
});
export type BuildContextRequest = z.infer<typeof buildContextRequestSchema>;

// --- Packet contents ---

export const contextMemoryItemSchema = z.object({
  memoryId: z.string().uuid(),
  content: z.string(),
  contentTruncated: z.boolean(),
  memoryType: z.string(),
  epistemicStatus: epistemicStatusSchema,
  epistemicTier: epistemicTierSchema,
  confidence: z.number().min(0).max(1),
  importance: z.number().int().min(1).max(5),
  occurredAt: z.string().nullable(),
  createdAt: z.string(),
  sourceType: sourceTypeSchema,
  sourceId: z.string().uuid(),
  score: z.number(),
  signals: rankingSignalsDtoSchema,
  matchedEntityIds: z.array(z.string().uuid()),
  /** Deterministic reasons this memory was included, derived from the same signals — never a free-text explanation invented after the fact. */
  includedBecause: z.array(z.string()),
});
export type ContextMemoryItem = z.infer<typeof contextMemoryItemSchema>;

export const contextEntityItemSchema = z.object({
  entityId: z.string().uuid(),
  entityType: entityTypeSchema,
  name: z.string(),
  /** 'target' = explicitly requested by the caller; 'direct' = named in the query text; 'expanded' = reached via bounded graph traversal from a direct/target entity. */
  matchType: z.enum(['target', 'direct', 'expanded']),
  hopDistance: z.number().int().min(0),
});
export type ContextEntityItem = z.infer<typeof contextEntityItemSchema>;

export const contextEvidenceItemSchema = z.object({
  evidenceId: z.string().uuid(),
  memoryId: z.string().uuid(),
  evidenceText: z.string().nullable(),
  epistemicStatus: epistemicStatusSchema,
  epistemicTier: epistemicTierSchema,
  confidence: z.number().min(0).max(1),
  extractionMethod: z.string(),
  createdAt: z.string(),
});
export type ContextEvidenceItem = z.infer<typeof contextEvidenceItemSchema>;

export const contextRelationshipItemSchema = z.object({
  relationshipId: z.string().uuid(),
  fromEntityId: z.string().uuid(),
  toEntityId: z.string().uuid(),
  relationshipType: z.string(),
  epistemicStatus: epistemicStatusSchema,
  epistemicTier: epistemicTierSchema,
  confidence: z.number().min(0).max(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  evidence: z.array(contextEvidenceItemSchema),
  evidenceTruncated: z.boolean(),
});
export type ContextRelationshipItem = z.infer<typeof contextRelationshipItemSchema>;

/**
 * A narrow, structural conflict signal — NOT contradiction resolution
 * (explicitly out of scope this phase). Currently the only detector
 * implemented is: two-or-more DISTINCT relationships sharing the same
 * (fromEntityId, relationshipType) but pointing at different
 * toEntityId within the same packet (e.g. "Arjun works_on Project A"
 * and "Arjun works_on Project B" both present). Both relationships
 * remain in `relationships` — this only adds a pointer to them.
 */
export const contextConflictSchema = z.object({
  type: z.literal('relationship_conflict'),
  fromEntityId: z.string().uuid(),
  relationshipType: z.string(),
  relationshipIds: z.array(z.string().uuid()).min(2),
  description: z.string(),
});
export type ContextConflict = z.infer<typeof contextConflictSchema>;

/**
 * Phase 17: a Personal Model fact connected to one of the packet's
 * entities — reuses the exact rollup fields personalModel.ts's own
 * DTO exposes (category, epistemicStatus, confidence, temporalState),
 * never a re-derived or re-interpreted copy. `includedBecause` mirrors
 * `contextMemoryItemSchema`'s field of the same name: a deterministic
 * reason grounded in the actual match (shared entity), never invented
 * free text.
 */
export const contextPersonalModelFactItemSchema = z.object({
  factId: z.string().uuid(),
  category: personalModelCategorySchema,
  subjectEntityId: z.string().uuid().nullable(),
  factText: z.string(),
  epistemicStatus: epistemicStatusSchema,
  epistemicTier: epistemicTierSchema,
  confidence: z.number().min(0).max(1),
  temporalState: factTemporalStateSchema,
  lastObservedAt: z.string(),
  includedBecause: z.array(z.string()),
});
export type ContextPersonalModelFactItem = z.infer<typeof contextPersonalModelFactItemSchema>;

/**
 * Phase 17: an Insight connected to one of the packet's entities —
 * same reuse discipline as the fact item above. Never includes a
 * dismissed insight (see contextEngine.ts); a superseded/resolved one
 * is included only with its real temporalState intact, never
 * presented as an active pattern.
 */
export const contextInsightItemSchema = z.object({
  insightId: z.string().uuid(),
  insightType: insightTypeSchema,
  statusClass: insightStatusClassSchema,
  temporalState: insightTemporalStateSchema,
  title: z.string(),
  description: z.string(),
  subjectEntityId: z.string().uuid().nullable(),
  confidence: z.number().min(0).max(1),
  lastObservedAt: z.string(),
  includedBecause: z.array(z.string()),
});
export type ContextInsightItem = z.infer<typeof contextInsightItemSchema>;

export const contextTruncationInfoSchema = z.object({
  memoriesTruncated: z.boolean(),
  entitiesTruncated: z.boolean(),
  relationshipsTruncated: z.boolean(),
  totalCandidateMemories: z.number().int().min(0),
  totalCandidateEntities: z.number().int().min(0),
  totalCandidateRelationships: z.number().int().min(0),
  /** Phase 17 */
  personalModelFactsTruncated: z.boolean(),
  totalCandidatePersonalModelFacts: z.number().int().min(0),
  insightsTruncated: z.boolean(),
  totalCandidateInsights: z.number().int().min(0),
  /** content.length / 4 summed across included memories + evidence quotes, rounded up — a rough, documented estimate, not a real tokenizer count. */
  estimatedTokens: z.number().int().min(0),
});
export type ContextTruncationInfo = z.infer<typeof contextTruncationInfoSchema>;

export const contextPacketSchema = z.object({
  version: z.literal(CONTEXT_PACKET_VERSION),
  query: z.string(),
  intent: intentTypeSchema,
  intentConfidence: z.number().min(0).max(1),
  intentSignals: z.array(z.string()),
  generatedAt: z.string(),
  memories: z.array(contextMemoryItemSchema),
  entities: z.array(contextEntityItemSchema),
  relationships: z.array(contextRelationshipItemSchema),
  /** Phase 17: Personal Model facts and Insights connected to the packet's entities — bounded, evidence-backed, never fabricated. Empty arrays are a legitimate, honest result. */
  personalModelFacts: z.array(contextPersonalModelFactItemSchema),
  insights: z.array(contextInsightItemSchema),
  conflicts: z.array(contextConflictSchema),
  budget: contextBudgetSchema,
  truncation: contextTruncationInfoSchema,
});
export type ContextPacket = z.infer<typeof contextPacketSchema>;

export const buildContextResponseSchema = contextPacketSchema;
export type BuildContextResponse = z.infer<typeof buildContextResponseSchema>;

// --- Grounded response contract (Phase 8's design, Phase 18's real consumer) ---

export const supportLevelSchema = z.enum([
  'directly_supported',
  'partially_supported',
  'inferred',
  'insufficient_evidence',
]);
export type SupportLevel = z.infer<typeof supportLevelSchema>;

/**
 * Phase 29: the small, user-relevant taxonomy of ways the REASONING
 * PROVIDER ITSELF can fail — deliberately narrower than
 * ReasoningProviderErrorCode (apps/api/.../reasoningProvider.ts), which
 * exists for server-side logging/tests and stays server-side, never
 * echoed to a client. This field is set ONLY when the provider actually
 * threw (even after the bounded retry in runReasoningSafely) — it is
 * NEVER set for a legitimate "not enough evidence in your vault"
 * answer (supportLevel='insufficient_evidence' with this field absent)
 * or for a citation-grounding downgrade (validateGroundedResponse's
 * existing caveat-based handling, unchanged). Absent/undefined means
 * "no provider failure occurred" — never defaulted to a literal value,
 * so every pre-existing GroundedResponse-constructing code path
 * (buildMockGroundedResponse, the empty-packet short-circuit,
 * validateGroundedResponse's grounding-loss fallback) needed zero
 * changes to keep compiling and keep meaning exactly what it always did.
 */
export const reasoningFailureKindSchema = z.enum([
  /** Timeout, network error, or the provider responding unavailable/5xx — from the user's perspective these are all "the AI isn't responding right now." */
  'unavailable',
  /** The provider's rate limit or quota was hit. Retrying immediately often won't help, but the condition can clear — distinct message from a plain outage. */
  'rate_limited',
  /** The provider rejected the request as unauthorized (bad/missing API key) — an operator/deployment problem, never something a user's retry can fix. */
  'configuration',
  /** The provider responded, but its output didn't match the required shape (malformed JSON, wrong schema, blocked content). Often transient with a real LLM. */
  'invalid_response',
  /** Anything else unclassified. */
  'internal',
]);
export type ReasoningFailureKind = z.infer<typeof reasoningFailureKindSchema>;

/**
 * What a ReasoningProvider returns. Deliberately does not expose raw
 * internal database details (no drizzle rows, no SQL) — only
 * IDs a client can already look up through the memory/graph/Personal
 * Model/Insight APIs, plus enough structured metadata to render "why"
 * without inventing it. citedPersonalModelFactIds/citedInsightIds
 * added in Phase 18 alongside those two packet sections (Phase 17) —
 * every id in every one of these four arrays is validated (Phase 18's
 * geminiReasoningProvider.ts) against the ContextPacket that was
 * actually supplied before this object is ever returned to a client;
 * a real ReasoningProvider implementation cannot make this contract
 * accept a fabricated id, only the validation layer can.
 */
export const groundedResponseSchema = z.object({
  answer: z.string(),
  supportLevel: supportLevelSchema,
  confidence: z.number().min(0).max(1),
  citedMemoryIds: z.array(z.string().uuid()),
  citedEntityIds: z.array(z.string().uuid()),
  citedPersonalModelFactIds: z.array(z.string().uuid()),
  citedInsightIds: z.array(z.string().uuid()),
  caveats: z.array(z.string()),
  /** Non-null only when supportLevel is not 'directly_supported' — a short, honest statement of what's uncertain. */
  uncertaintyNote: z.string().nullable(),
  /** Phase 29 — see reasoningFailureKindSchema's comment. Absent = the provider did not fail (this may still be a legitimate insufficient_evidence answer). */
  reasoningFailure: reasoningFailureKindSchema.optional(),
  /** Phase 29 — true only when a fresh user-initiated retry of the SAME request might plausibly succeed. False for 'configuration' (nothing the user can do); absent has the same meaning as false. */
  retryable: z.boolean().optional(),
});
export type GroundedResponse = z.infer<typeof groundedResponseSchema>;

/**
 * Phase 18's POST /reason request — identical shape to buildContextRequestSchema
 * (the same query/target-entity/date-range/graphHops/budget fields), aliased
 * rather than redefined so the two endpoints can never silently drift apart.
 * The reasoning endpoint runs the exact same buildContext call context.routes.ts
 * already uses, then hands the resulting packet to a ReasoningProvider —
 * no second retrieval implementation.
 */
export const reasonRequestSchema = buildContextRequestSchema;
export type ReasonRequest = z.infer<typeof reasonRequestSchema>;

export const reasonResponseSchema = groundedResponseSchema;
export type ReasonResponse = z.infer<typeof reasonResponseSchema>;
