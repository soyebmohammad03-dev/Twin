import { and, asc, cosineDistance, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { entities, memories, memoryEntities, type Queryable } from '@twin/db';
import type { EntityType } from '@twin/contracts';
import type { EntityRow } from '../entities/entities.service.js';
import type { MemoryWithRelations } from '../memories/memories.service.js';
import { containsWholeWord } from './textMatch.js';
import { getEmbeddingProvider, type EmbeddingProvider } from './embeddings/index.js';
import { parseTemporalExpression } from '../context/temporalExpressions.js';
import { traverseFromEntity } from '../graph/traversal.service.js';
import {
  computeRankScore,
  computeRecencyScore,
  normalizeImportance,
  ENTITY_MATCH_DIRECT,
  ENTITY_MATCH_EXPANDED,
  ENTITY_MATCH_NONE,
  type RankingSignals,
  type RankingWeights,
} from './ranking.js';

/**
 * Hybrid memory retrieval — the pipeline described in this module's
 * design doc:
 *
 *   query understanding -> candidate retrieval (semantic + lexical +
 *   entity-linked) -> ranking -> evidence/provenance -> final results
 *
 * Every function here takes `userId` from the caller (retrieval.routes.ts
 * derives it from the authenticated request, never from the request
 * body/query) and every query is scoped by it — there is no code path
 * in this file that can return another user's memories, embeddings, or
 * entities.
 */

/** Per-branch cap on how many rows each candidate-retrieval query considers, before the branches are unioned and ranked. Bounds cost; documented rather than tuned. */
const CANDIDATE_POOL_LIMIT = 50;

export interface MatchedEntity {
  id: string;
  name: string;
  entityType: EntityType;
  matchType: 'direct' | 'expanded';
}

export interface RetrievedMemory {
  memory: MemoryWithRelations;
  score: number;
  signals: RankingSignals;
  matchedEntities: MatchedEntity[];
  matchReasons: string[];
}

/** Structured retrieval diagnostics — mirrors Fastify's request.log shape (the only logger already in use anywhere in this codebase) so route callers can pass `request.log` directly with no adapter. Never given memory content, only counts/ids/timings. */
export interface RetrievalLogger {
  info: (obj: Record<string, unknown>, msg: string) => void;
}

export interface SearchMemoriesOptions {
  query: string;
  limit: number;
  includeArchived: boolean;
  occurredAfter?: Date;
  occurredBefore?: Date;
  rankingWeights?: RankingWeights;
  /** Test-only injection seam, same contract as ingestion's aiProviderOverride/embeddingProviderOverride: undefined resolves normally from env, null forces "no embedding provider". */
  embeddingProviderOverride?: EmbeddingProvider | null;
  /** Phase 30: optional structured diagnostics sink (Step 14) — omitted by pure/unit tests, passed as `request.log` by retrieval.routes.ts and contextEngine.ts's callers. */
  logger?: RetrievalLogger;
}

export interface SearchMemoriesResult {
  results: RetrievedMemory[];
  /** Every entity detected in the query (directly named or reached via one hop of graph expansion) — surfaced even when it produced no results, so a caller can tell "no memories about Arjun" apart from "didn't recognize 'Arjun' as anyone you know". */
  matchedEntities: MatchedEntity[];
  /** False when no embedding provider is configured, the query embedding call failed, or the query was empty — callers can use this to explain a semantic-similarity score of 0 across the board. */
  queryEmbeddingGenerated: boolean;
}

export async function searchMemories(
  db: Queryable,
  userId: string,
  options: SearchMemoriesOptions,
): Promise<SearchMemoriesResult> {
  const startedAt = Date.now();
  const trimmedQuery = options.query.trim();

  // --- 0. Temporal query understanding (Phase 17): a caller-supplied
  // occurredAfter/occurredBefore always wins; the deterministic parser
  // (context/temporalExpressions.ts) only fills in a date range when
  // the caller gave neither. Shared with contextEngine.ts's buildContext
  // so "yesterday"/"last week"/etc. behave identically whether reached
  // via plain search or context assembly. ---
  let effectiveOccurredAfter = options.occurredAfter;
  let effectiveOccurredBefore = options.occurredBefore;
  if (!effectiveOccurredAfter && !effectiveOccurredBefore) {
    const temporalMatch = parseTemporalExpression(trimmedQuery);
    if (temporalMatch) {
      effectiveOccurredAfter = temporalMatch.occurredAfter;
      effectiveOccurredBefore = temporalMatch.occurredBefore;
    }
  }

  // --- 1. Query understanding: entity mentions + bounded 1-hop expansion ---
  const { directEntities, expandedEntities } = await detectQueryEntities(db, userId, trimmedQuery);
  const directIdSet = new Set(directEntities.map((e) => e.id));
  const expandedIdSet = new Set(expandedEntities.map((e) => e.id));
  const matchedEntities: MatchedEntity[] = [
    ...directEntities.map((e) => toMatchedEntity(e, 'direct' as const)),
    ...expandedEntities.map((e) => toMatchedEntity(e, 'expanded' as const)),
  ];

  // --- 2. Candidate retrieval ---
  let queryEmbedding: number[] | null = null;
  if (trimmedQuery.length > 0) {
    const provider = options.embeddingProviderOverride !== undefined ? options.embeddingProviderOverride : getEmbeddingProvider();
    if (provider) {
      try {
        queryEmbedding = (await provider.embed(trimmedQuery)).values;
      } catch {
        // Fail safe: semantic branch simply contributes nothing. Never
        // surfaces as a search failure — lexical/entity signals still work.
        queryEmbedding = null;
      }
    }
  }

  const candidateIds = new Set<string>();
  const dateRange = { occurredAfter: effectiveOccurredAfter, occurredBefore: effectiveOccurredBefore };
  let semanticCandidateCount = 0;
  let lexicalCandidateCount = 0;
  let entityCandidateCount = 0;

  if (queryEmbedding) {
    const ids = await semanticCandidateIds(db, userId, queryEmbedding, options.includeArchived, dateRange);
    semanticCandidateCount = ids.length;
    for (const id of ids) candidateIds.add(id);
  }
  if (trimmedQuery.length > 0) {
    const ids = await lexicalCandidateIds(db, userId, trimmedQuery, options.includeArchived, dateRange);
    lexicalCandidateCount = ids.length;
    for (const id of ids) candidateIds.add(id);
  }
  const allEntityIds = [...directIdSet, ...expandedIdSet];
  if (allEntityIds.length > 0) {
    const ids = await entityLinkedMemoryIds(db, userId, allEntityIds, options.includeArchived, dateRange);
    entityCandidateCount = ids.length;
    for (const id of ids) candidateIds.add(id);
  }
  const dedupedCandidateCount = candidateIds.size;
  const candidateCountsBeforeDedup = semanticCandidateCount + lexicalCandidateCount + entityCandidateCount;

  if (candidateIds.size === 0) {
    options.logger?.info(
      {
        userId,
        semanticCandidateCount,
        lexicalCandidateCount,
        entityCandidateCount,
        dedupedCandidateCount: 0,
        resultCount: 0,
        queryEmbeddingGenerated: queryEmbedding !== null,
        latencyMs: Date.now() - startedAt,
      },
      'retrieval.searchMemories',
    );
    return { results: [], matchedEntities, queryEmbeddingGenerated: queryEmbedding !== null };
  }

  // --- 3. Signal computation for every candidate ---
  const candidateMemories = await getMemoriesByIds(db, userId, [...candidateIds], options.includeArchived, dateRange);
  const similarityById = queryEmbedding
    ? await semanticSimilarityForIds(db, userId, [...candidateIds], queryEmbedding)
    : new Map<string, number>();
  const lexicalScoreById =
    trimmedQuery.length > 0 ? await lexicalScoreForIds(db, userId, [...candidateIds], trimmedQuery) : new Map<string, number>();

  const now = new Date();
  const scored: RetrievedMemory[] = candidateMemories.map((memory) => {
    const linkedEntityIds = memory.entityLinks.map((l) => l.entityId);
    const hasDirect = linkedEntityIds.some((id) => directIdSet.has(id));
    const hasExpanded = !hasDirect && linkedEntityIds.some((id) => expandedIdSet.has(id));
    const entityMatchScore = hasDirect ? ENTITY_MATCH_DIRECT : hasExpanded ? ENTITY_MATCH_EXPANDED : ENTITY_MATCH_NONE;

    const signals: RankingSignals = {
      semanticSimilarity: similarityById.get(memory.id) ?? 0,
      lexicalScore: lexicalScoreById.get(memory.id) ?? 0,
      entityMatchScore,
      recencyScore: computeRecencyScore(memory.occurredAt ?? memory.createdAt, now),
      importanceScore: normalizeImportance(memory.importance),
      confidenceScore: Number(memory.confidence),
    };

    const memoryMatchedEntities: MatchedEntity[] = memory.entityLinks
      .filter((l) => directIdSet.has(l.entityId) || expandedIdSet.has(l.entityId))
      .map((l) => toMatchedEntity(l.entity, directIdSet.has(l.entityId) ? 'direct' : 'expanded'));

    return {
      memory,
      score: computeRankScore(signals, options.rankingWeights),
      signals,
      matchedEntities: memoryMatchedEntities,
      matchReasons: buildMatchReasons(signals, memoryMatchedEntities),
    };
  });

  // --- 4. Deterministic ranking + limit ---
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aDate = (a.memory.occurredAt ?? a.memory.createdAt).getTime();
    const bDate = (b.memory.occurredAt ?? b.memory.createdAt).getTime();
    if (bDate !== aDate) return bDate - aDate;
    return a.memory.id.localeCompare(b.memory.id);
  });

  const finalResults = scored.slice(0, options.limit);
  options.logger?.info(
    {
      userId,
      semanticCandidateCount,
      lexicalCandidateCount,
      entityCandidateCount,
      candidateCountsBeforeDedup,
      dedupedCandidateCount,
      resultCount: finalResults.length,
      queryEmbeddingGenerated: queryEmbedding !== null,
      latencyMs: Date.now() - startedAt,
    },
    'retrieval.searchMemories',
  );

  return {
    results: finalResults,
    matchedEntities,
    queryEmbeddingGenerated: queryEmbedding !== null,
  };
}

// ---------------------------------------------------------------------------
// Query understanding
// ---------------------------------------------------------------------------

/**
 * Direct matches: the user's existing entities whose name appears
 * (whole-word, case-insensitive) in the query. Expanded matches:
 * entities exactly one hop away from a direct match, via the shared
 * graph traversal utility (modules/graph/traversal.service.ts) — e.g.
 * query "Arjun" directly matches the person "Arjun", and expands to
 * "Drone Project" if a relationship links them, surfacing memories
 * about the project even though the query never named it. Bounded to
 * exactly one hop — a second hop (Drone Project -> Architecture
 * Decision) is intentionally NOT followed here, keeping retrieval's
 * expansion small and deterministic (the standalone graph API can
 * still walk 2 hops when a caller explicitly wants that).
 */
async function detectQueryEntities(
  db: Queryable,
  userId: string,
  query: string,
): Promise<{ directEntities: EntityRow[]; expandedEntities: EntityRow[] }> {
  if (query.length === 0) return { directEntities: [], expandedEntities: [] };

  const allEntities = await db
    .select()
    .from(entities)
    .where(and(eq(entities.userId, userId), isNull(entities.archivedAt)));

  const lowerQuery = query.toLowerCase();
  const directEntities = allEntities.filter((e) => e.name.trim().length >= 2 && containsWholeWord(lowerQuery, e.name));
  if (directEntities.length === 0) return { directEntities: [], expandedEntities: [] };

  const directIdSet = new Set(directEntities.map((e) => e.id));
  const expandedById = new Map<string, EntityRow>();
  for (const direct of directEntities) {
    const oneHop = await traverseFromEntity(db, userId, direct.id, { hops: 1 });
    for (const node of oneHop) {
      if (!directIdSet.has(node.entity.id)) {
        expandedById.set(node.entity.id, node.entity);
      }
    }
  }

  return { directEntities, expandedEntities: [...expandedById.values()] };
}

function toMatchedEntity(entity: EntityRow, matchType: 'direct' | 'expanded'): MatchedEntity {
  return { id: entity.id, name: entity.name, entityType: entity.entityType, matchType };
}

// ---------------------------------------------------------------------------
// Candidate retrieval
// ---------------------------------------------------------------------------

interface DateRange {
  occurredAfter?: Date;
  occurredBefore?: Date;
}

/**
 * The date a memory is actually "about", for range-filtering purposes —
 * occurredAt when it's known, createdAt otherwise. Most real memories
 * (anything captured without an explicit occurredAt override) have a
 * NULL occurredAt column; filtering `gte(memories.occurredAt, ...)`
 * directly would silently exclude every one of them from ANY date
 * range, including ranges a caller expects to mean "today"/"this week"
 * for memories captured today/this week. Discovered live (Phase 17,
 * while verifying the new deterministic temporal-expression parser
 * against a real signup+capture flow) — this bug predates Phase 17
 * (retrieval.service.ts's occurredAfter/occurredBefore params were
 * already public API), but Phase 17's parser is what makes hitting it
 * the COMMON case instead of a rare, explicit-caller-only path, so
 * it's fixed here rather than left to silently undermine the very
 * feature this phase adds. Mirrors the exact same coalesce convention
 * ranking.ts's recencyScore and contextEngine.ts's explicit-linked-
 * candidate filtering already use — not a new rule, just applied here
 * too.
 */
const REFERENCE_DATE_EXPR = sql`coalesce(${memories.occurredAt}, ${memories.createdAt})`;

function baseConditions(userId: string, includeArchived: boolean, range: DateRange) {
  const conditions = [eq(memories.userId, userId)];
  if (!includeArchived) conditions.push(isNull(memories.deletedAt));
  if (range.occurredAfter) conditions.push(gte(REFERENCE_DATE_EXPR, range.occurredAfter));
  if (range.occurredBefore) conditions.push(lte(REFERENCE_DATE_EXPR, range.occurredBefore));
  return conditions;
}

async function semanticCandidateIds(
  db: Queryable,
  userId: string,
  queryEmbedding: number[],
  includeArchived: boolean,
  range: DateRange,
): Promise<string[]> {
  const rows = await db
    .select({ id: memories.id })
    .from(memories)
    .where(and(...baseConditions(userId, includeArchived, range), isNotNull(memories.embedding)))
    .orderBy(cosineDistance(memories.embedding, queryEmbedding), asc(memories.id))
    .limit(CANDIDATE_POOL_LIMIT);
  return rows.map((r) => r.id);
}

async function lexicalCandidateIds(
  db: Queryable,
  userId: string,
  query: string,
  includeArchived: boolean,
  range: DateRange,
): Promise<string[]> {
  const tsQuery = sql`plainto_tsquery('english', ${query})`;
  const rows = await db
    .select({ id: memories.id })
    .from(memories)
    .where(and(...baseConditions(userId, includeArchived, range), sql`to_tsvector('english', ${memories.content}) @@ ${tsQuery}`))
    .orderBy(desc(sql`ts_rank(to_tsvector('english', ${memories.content}), ${tsQuery})`), asc(memories.id))
    .limit(CANDIDATE_POOL_LIMIT);
  return rows.map((r) => r.id);
}

async function entityLinkedMemoryIds(
  db: Queryable,
  userId: string,
  entityIds: string[],
  includeArchived: boolean,
  range: DateRange,
): Promise<string[]> {
  const rows = await db
    .select({ id: memories.id })
    .from(memoryEntities)
    .innerJoin(memories, eq(memoryEntities.memoryId, memories.id))
    .where(and(...baseConditions(userId, includeArchived, range), inArray(memoryEntities.entityId, entityIds)))
    .orderBy(desc(memories.occurredAt), desc(memories.createdAt), asc(memories.id))
    .limit(CANDIDATE_POOL_LIMIT);
  return [...new Set(rows.map((r) => r.id))];
}

async function getMemoriesByIds(
  db: Queryable,
  userId: string,
  ids: string[],
  includeArchived: boolean,
  range: DateRange,
): Promise<MemoryWithRelations[]> {
  const conditions = [eq(memories.userId, userId), inArray(memories.id, ids)];
  if (!includeArchived) conditions.push(isNull(memories.deletedAt));
  if (range.occurredAfter) conditions.push(gte(REFERENCE_DATE_EXPR, range.occurredAfter));
  if (range.occurredBefore) conditions.push(lte(REFERENCE_DATE_EXPR, range.occurredBefore));

  const result = await db.query.memories.findMany({
    where: and(...conditions),
    with: { source: true, entityLinks: { with: { entity: true } } },
  });
  return result as MemoryWithRelations[];
}

async function semanticSimilarityForIds(
  db: Queryable,
  userId: string,
  ids: string[],
  queryEmbedding: number[],
): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: memories.id, distance: cosineDistance(memories.embedding, queryEmbedding) })
    .from(memories)
    .where(and(eq(memories.userId, userId), inArray(memories.id, ids), isNotNull(memories.embedding)));

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.id, 1 - Number(row.distance));
  }
  return map;
}

async function lexicalScoreForIds(db: Queryable, userId: string, ids: string[], query: string): Promise<Map<string, number>> {
  const tsQuery = sql`plainto_tsquery('english', ${query})`;
  const rows = await db
    .select({
      id: memories.id,
      rank: sql<number>`ts_rank(to_tsvector('english', ${memories.content}), ${tsQuery})`,
    })
    .from(memories)
    .where(and(eq(memories.userId, userId), inArray(memories.id, ids)));

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.id, Number(row.rank));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Evidence / provenance
// ---------------------------------------------------------------------------

/**
 * Human-readable reasons, derived deterministically from the actual
 * computed signals — never a free-text explanation invented after the
 * fact. Thresholds here (0.3, 0.7, 0.75) only govern which reasons get
 * *mentioned*; they do not affect ranking (ranking.ts's weighted sum
 * does) and are display heuristics, not tuned values.
 */
// Postgres's ts_rank returns a vanishingly small nonzero value (e.g.
// 1e-20) even for content that doesn't really match a query — a
// floating-point artifact of the ranking function, not a real partial
// match. Discovered via live testing (a search whose only real signal
// was semantic similarity was still labeled "matches your query's
// exact wording"). A strict `> 0` check treats that noise as a real
// lexical hit; this threshold is comfortably above it while still
// well below any genuine ts_rank score.
export const MIN_MEANINGFUL_LEXICAL_SCORE = 1e-6;

export function buildMatchReasons(signals: RankingSignals, matchedEntities: MatchedEntity[]): string[] {
  const reasons: string[] = [];
  if (signals.semanticSimilarity >= 0.3) {
    reasons.push(`semantically similar to your query (similarity ${signals.semanticSimilarity.toFixed(2)})`);
  }
  if (signals.lexicalScore > MIN_MEANINGFUL_LEXICAL_SCORE) {
    reasons.push('matches your query’s exact wording');
  }
  for (const entity of matchedEntities) {
    reasons.push(
      entity.matchType === 'direct'
        ? `mentions "${entity.name}", which your query named directly`
        : `connected to "${entity.name}", related to something your query named`,
    );
  }
  if (signals.recencyScore >= 0.7) reasons.push('recent');
  if (signals.importanceScore >= 0.75) reasons.push('marked important');
  if (reasons.length === 0) reasons.push('weak overall match on the available signals');
  return reasons;
}
