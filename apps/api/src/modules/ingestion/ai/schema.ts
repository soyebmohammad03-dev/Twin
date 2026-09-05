import { z } from 'zod';
import { epistemicStatusSchema, entityTypeSchema } from '@twin/contracts';

/**
 * The exact JSON shape the AI provider must return. This is the
 * "STRUCTURED EXTRACTION" contract — the model's raw text response is
 * JSON.parsed and checked against this schema before anything in it
 * is trusted (see extraction/pipeline.ts's parseStructuredExtraction).
 *
 * Every claim (entity mention, memory, relationship) carries its own
 * `evidence` — a short VERBATIM quote from the input the model is
 * required to copy, not paraphrase. The validation stage checks that
 * quote actually appears in the source text (see isGrounded in
 * pipeline.ts) and drops anything that doesn't — the concrete
 * mechanism behind "never invent information": a claim with no
 * verifiable textual anchor in what the user actually wrote is
 * dropped, not stored as a guess.
 */

const evidenceSchema = z
  .string()
  .trim()
  .min(3, 'evidence must be a real quote, not empty/trivial')
  .max(300);

const confidenceSchema = z.number().min(0).max(1);

/**
 * A real model asked for "a date" in natural text reliably produces
 * plausible-but-not-strictly-ISO-8601 strings — a bare "2027-08-04"
 * with no time/offset component is common and correct, not malformed.
 * z.string().datetime() rejects that (it requires a full timestamp),
 * which would fail the ENTIRE extraction over one reasonably-formatted
 * date. Accept anything genuinely parseable instead; normalizeDate
 * (below) converts it to a real ISO string before it's used anywhere.
 */
const dateStringSchema = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'must be a valid, parseable date/datetime string' });

/** Converts a validated dateStringSchema value to a full ISO-8601 string, for callers (e.g. createMemoryTx's occurredAt) that require strict ISO format. */
export function normalizeDate(value: string): string {
  return new Date(value).toISOString();
}

/** People/projects/goals/decisions/ideas/events mentioned in the content — become `entities` rows once resolved. */
export const extractedEntitySchema = z.object({
  type: entityTypeSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  /** Required for entity type 'event' if the AI wants it created as an entity — omit rather than guess. */
  startsAt: dateStringSchema.optional(),
  /**
   * Phase 31: only meaningful for entity type 'decision' — whether the
   * text uses genuinely finalized language ("I decided...", "I've
   * decided...", "The decision is...", "I'm going with...") versus
   * tentative language ("I'm considering...", "leaning toward...",
   * "might", "maybe"). Omit rather than guess "decided" — the pipeline
   * treats a missing/'tentative' value as an open decision (packages/db's
   * decisions.status default), never finalizing one without explicit
   * textual evidence. This never applies retroactively to an EXISTING
   * decision entity (see pipeline.ts's storeExtractionResult) — only a
   * brand-new decision entity's initial status is set from this.
   */
  decisionStatus: z.enum(['tentative', 'decided']).optional(),
  /**
   * Phase 32: only meaningful for entity type 'goal' — a target/deadline
   * date, ONLY if the text states one specifically enough to actually
   * parse (e.g. "by 2027-03-01"). A vague relative phrase like "next
   * month" or "before the semester ends" must NOT be forced into this
   * field — omit it rather than approximate. Same dateStringSchema (and
   * the same "must genuinely Date.parse" honesty guarantee) as startsAt.
   */
  targetDate: dateStringSchema.optional(),
  epistemicStatus: epistemicStatusSchema,
  confidence: confidenceSchema,
  evidence: evidenceSchema,
});
export type ExtractedEntity = z.infer<typeof extractedEntitySchema>;

/**
 * The atomic content kinds a captured input can yield beyond the raw
 * capture itself — preferences, standalone facts, decision/idea/event
 * narratives, and general relevant context that doesn't fit the other
 * categories. Kept as a closed enum (not free text) so the model's
 * output stays predictable; DB storage still uses free-text memoryType,
 * this enum is just the vocabulary offered to the model.
 */
export const extractedMemoryKindSchema = z.enum([
  'fact',
  'preference',
  'context',
  'person',
  'project',
  'goal',
  'decision',
  'idea',
  'event',
]);

export const extractedMemorySchema = z.object({
  kind: extractedMemoryKindSchema,
  /** Twin's own restatement of the claim — may summarize, but must not add facts absent from the input. */
  content: z.string().trim().min(1).max(2000),
  epistemicStatus: epistemicStatusSchema,
  confidence: confidenceSchema,
  importance: z.number().int().min(1).max(5),
  /** An important date this memory concerns, if the input states one confidently. */
  occurredAt: dateStringSchema.optional(),
  /** Names of entities (from `entities[]` above, or the user's existing entities) this memory concerns. */
  relatedEntityNames: z.array(z.string().trim().min(1)).max(10).default([]),
  evidence: evidenceSchema,
});
export type ExtractedMemory = z.infer<typeof extractedMemorySchema>;

export const extractedRelationshipSchema = z.object({
  fromEntityName: z.string().trim().min(1),
  toEntityName: z.string().trim().min(1),
  /** Open vocabulary, e.g. "works_with", "reports_to", "friend_of" — mirrors entity_relationships.relationshipType. */
  relationshipType: z.string().trim().min(1).max(64),
  /** Only 'explicit' or 'inferred' make sense for a relationship between two entities; enforced further in pipeline.ts's semantic validation. */
  epistemicStatus: epistemicStatusSchema,
  confidence: confidenceSchema,
  evidence: evidenceSchema,
});
export type ExtractedRelationship = z.infer<typeof extractedRelationshipSchema>;

export const aiExtractionResultSchema = z.object({
  entities: z.array(extractedEntitySchema).max(30).default([]),
  memories: z.array(extractedMemorySchema).max(20).default([]),
  relationships: z.array(extractedRelationshipSchema).max(20).default([]),
});
export type AIExtractionResult = z.infer<typeof aiExtractionResultSchema>;

/**
 * Gemini's `responseSchema` uses an OpenAPI-3.0 subset, not JSON
 * Schema proper (no `$ref`, no `additionalProperties`, enums must be
 * plain string arrays) — hand-written to mirror aiExtractionResultSchema
 * above rather than derived, since the two describe the same contract
 * from different sides (what we require vs. what we ask the model to
 * produce). Keep them in sync when the schema changes.
 */
export const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['person', 'project', 'goal', 'decision', 'idea', 'event'] },
          name: { type: 'string' },
          description: { type: 'string' },
          startsAt: { type: 'string' },
          decisionStatus: { type: 'string', enum: ['tentative', 'decided'] },
          targetDate: { type: 'string' },
          epistemicStatus: {
            type: 'string',
            enum: ['explicit', 'from_source', 'reported_by_other', 'inferred', 'probable'],
          },
          confidence: { type: 'number' },
          evidence: { type: 'string' },
        },
        required: ['type', 'name', 'epistemicStatus', 'confidence', 'evidence'],
      },
    },
    memories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['fact', 'preference', 'context', 'person', 'project', 'goal', 'decision', 'idea', 'event'],
          },
          content: { type: 'string' },
          epistemicStatus: {
            type: 'string',
            enum: ['explicit', 'from_source', 'reported_by_other', 'inferred', 'probable'],
          },
          confidence: { type: 'number' },
          importance: { type: 'integer' },
          occurredAt: { type: 'string' },
          relatedEntityNames: { type: 'array', items: { type: 'string' } },
          evidence: { type: 'string' },
        },
        required: ['kind', 'content', 'epistemicStatus', 'confidence', 'importance', 'evidence'],
      },
    },
    relationships: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fromEntityName: { type: 'string' },
          toEntityName: { type: 'string' },
          relationshipType: { type: 'string' },
          epistemicStatus: {
            type: 'string',
            enum: ['explicit', 'from_source', 'reported_by_other', 'inferred', 'probable'],
          },
          confidence: { type: 'number' },
          evidence: { type: 'string' },
        },
        required: ['fromEntityName', 'toEntityName', 'relationshipType', 'epistemicStatus', 'confidence', 'evidence'],
      },
    },
  },
  required: ['entities', 'memories', 'relationships'],
} as const;
