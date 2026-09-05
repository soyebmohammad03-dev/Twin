import { z } from 'zod';
import { entityTypeSchema, memoryDetailDtoSchema } from './memory.js';

/**
 * Contracts for Phase 6's hybrid memory retrieval
 * (apps/api/src/modules/retrieval). Deliberately does not expose
 * internal database details — no raw SQL, no pgvector distance
 * values, no drizzle row shapes — only a similarity score already
 * normalized to a 0-1-ish range and a named signal breakdown.
 */

export const searchMemoriesRequestSchema = z.object({
  query: z.string().trim().min(1, 'query must not be empty').max(2000, 'query is too long'),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  includeArchived: z.coerce.boolean().default(false),
  occurredAfter: z.string().datetime().optional(),
  occurredBefore: z.string().datetime().optional(),
});
export type SearchMemoriesRequest = z.infer<typeof searchMemoriesRequestSchema>;

export const matchedEntityDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  entityType: entityTypeSchema,
  matchType: z.enum(['direct', 'expanded']),
});
export type MatchedEntityDto = z.infer<typeof matchedEntityDtoSchema>;

export const rankingSignalsDtoSchema = z.object({
  semanticSimilarity: z.number(),
  lexicalScore: z.number(),
  entityMatchScore: z.number(),
  recencyScore: z.number(),
  importanceScore: z.number(),
  confidenceScore: z.number(),
});
export type RankingSignalsDto = z.infer<typeof rankingSignalsDtoSchema>;

/**
 * One retrieved memory plus enough evidence to explain why it was
 * retrieved — the full memory (source, entity links, epistemic
 * status, confidence, importance, createdAt, occurredAt), the combined
 * relevance score, its signal breakdown, which entities matched, and
 * plain-language reasons derived from those signals. Never a
 * free-text explanation invented independently of the signals.
 */
export const retrievedMemoryDtoSchema = z.object({
  memory: memoryDetailDtoSchema,
  score: z.number(),
  signals: rankingSignalsDtoSchema,
  matchedEntities: z.array(matchedEntityDtoSchema),
  matchReasons: z.array(z.string()),
});
export type RetrievedMemoryDto = z.infer<typeof retrievedMemoryDtoSchema>;

export const searchMemoriesResponseSchema = z.object({
  results: z.array(retrievedMemoryDtoSchema),
  matchedEntities: z.array(matchedEntityDtoSchema),
  queryEmbeddingGenerated: z.boolean(),
});
export type SearchMemoriesResponse = z.infer<typeof searchMemoriesResponseSchema>;
