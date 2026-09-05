import { and, eq, inArray, isNull } from 'drizzle-orm';
import { personalModelFacts, insights, type Queryable } from '@twin/db';
import type {
  ContextConflict,
  ContextEntityItem,
  ContextEvidenceItem,
  ContextMemoryItem,
  ContextPacket,
  ContextPersonalModelFactItem,
  ContextInsightItem,
  ContextRelationshipItem,
  ContextBudgetInput,
  EntityType,
  PersonalModelCategory,
  FactTemporalState,
  InsightType,
  InsightStatusClass,
  InsightTemporalState,
} from '@twin/contracts';
import { CONTEXT_PACKET_VERSION } from '@twin/contracts';
import { getEntityById, getEntitySubtypesBatch, type EntityRow } from '../entities/entities.service.js';
import { getSupportingMemories } from '../graph/graph.service.js';
import { traverseFromEntity } from '../graph/traversal.service.js';
import {
  listRelationshipsAmongEntities,
  getRelationshipEvidenceBatch,
  type EntityRelationshipRow,
} from '../graph/relationships.service.js';
import { searchMemories, type RetrievedMemory, type MatchedEntity, type RetrievalLogger } from '../retrieval/retrieval.service.js';
import {
  computeRankScore,
  computeRecencyScore,
  normalizeImportance,
  ENTITY_MATCH_DIRECT,
  type RankingSignals,
} from '../retrieval/ranking.js';
import { resolveContextBudget, truncateContent, estimateTokens } from './budget.js';
import { computeEpistemicTier, EPISTEMIC_TIER_RANK } from './epistemicTier.js';
import { selectDiverseByContent } from './diversity.js';
import { detectRelationshipConflicts } from './conflicts.js';
import { DeterministicIntentClassifier, type IntentClassifier } from './intent.js';
import { parseTemporalExpression } from './temporalExpressions.js';

export class ContextError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 404) {
    super(message);
    this.statusCode = statusCode;
  }
}

export interface BuildContextInput {
  query: string;
  targetEntityId?: string;
  personEntityId?: string;
  projectEntityId?: string;
  goalEntityId?: string;
  decisionEntityId?: string;
  occurredAfter?: Date;
  occurredBefore?: Date;
  /** 1 or 2 — further clamped to Phase 7's MAX_TRAVERSAL_HOPS inside traverseFromEntity regardless. */
  graphHops?: 1 | 2;
  budget?: ContextBudgetInput;
}

/** How many extra candidate memories to pull beyond the final budget, so diversity selection has real choices to make instead of just truncating the same top-N. Bounded by MAX_CANDIDATE_POOL either way — a documented heuristic, not tuned. */
const CANDIDATE_OVERSAMPLE_FACTOR = 3;
const MAX_CANDIDATE_POOL = 40;

interface FocusEntity {
  id: string;
  name: string;
  entityType: EntityType;
  matchType: 'target' | 'direct' | 'expanded';
  hopDistance: number;
}

const MATCH_TYPE_RANK: Record<FocusEntity['matchType'], number> = { target: 2, direct: 1, expanded: 0 };

/**
 * Item 1's ContextEngine.buildContext(...) — the single entry point
 * that turns a query/intent (plus optional explicit targets) into a
 * bounded, evidence-backed ContextPacket. Every step below reuses an
 * existing, already-tested Phase 6/7 building block rather than
 * re-implementing retrieval or graph traversal:
 *
 *   query understanding  -> reuses retrieval.service's searchMemories,
 *                            which already does entity detection + one
 *                            hop of graph expansion internally
 *   candidate retrieval  -> searchMemories (semantic + lexical +
 *                            entity-linked) PLUS memories directly
 *                            linked to any explicit target entities
 *   ranking              -> reuses ranking.ts's pure computeRankScore
 *   diversity selection  -> diversity.ts (new, pure, Phase 8)
 *   graph expansion      -> reuses traversal.service's traverseFromEntity
 *                            (bounded, cycle-safe, user-scoped — Phase 7's
 *                            guarantees apply unchanged)
 *   evidence resolution  -> reuses relationships.service's evidence reads
 *   packet assembly      -> this file
 *
 * Every DB call here is scoped by `userId`; explicit target entity ids
 * are resolved through getEntityById, which already 404s rather than
 * returning another user's entity — the same pattern graph.routes.ts
 * uses, so a client can never assemble context around an entity they
 * don't own.
 */
export async function buildContext(
  db: Queryable,
  userId: string,
  input: BuildContextInput,
  deps: { intentClassifier?: IntentClassifier; logger?: RetrievalLogger } = {},
): Promise<ContextPacket> {
  const budget = resolveContextBudget(input.budget);
  const intentClassifier = deps.intentClassifier ?? new DeterministicIntentClassifier();
  const graphHops: 1 | 2 = input.graphHops ?? 2;

  // --- 0. Temporal query understanding (Phase 17) — a caller-supplied
  // explicit occurredAfter/occurredBefore always wins; the deterministic
  // parser only fills in a date range when the caller gave neither, so
  // it can never narrow a request the caller already scoped explicitly. ---
  let effectiveOccurredAfter = input.occurredAfter;
  let effectiveOccurredBefore = input.occurredBefore;
  let temporalSignal: string | null = null;
  if (!effectiveOccurredAfter && !effectiveOccurredBefore) {
    const temporalMatch = parseTemporalExpression(input.query);
    if (temporalMatch) {
      effectiveOccurredAfter = temporalMatch.occurredAfter;
      effectiveOccurredBefore = temporalMatch.occurredBefore;
      temporalSignal = temporalMatch.signal;
    }
  }

  // --- 1. Resolve explicit target entities (ownership-checked) ---
  const explicitFields: { field: 'target' | 'person' | 'project' | 'goal' | 'decision'; id: string | undefined }[] = [
    { field: 'target', id: input.targetEntityId },
    { field: 'person', id: input.personEntityId },
    { field: 'project', id: input.projectEntityId },
    { field: 'goal', id: input.goalEntityId },
    { field: 'decision', id: input.decisionEntityId },
  ];
  const explicitEntities: { entity: EntityRow; field: string }[] = [];
  for (const entry of explicitFields) {
    if (!entry.id) continue;
    const entity = await getEntityById(db, userId, entry.id);
    if (!entity) {
      throw new ContextError(`Entity not found: ${entry.id}`, 404);
    }
    explicitEntities.push({ entity, field: entry.field });
  }
  const explicitTargets = {
    person: explicitEntities.some((e) => e.field === 'person'),
    project: explicitEntities.some((e) => e.field === 'project'),
    goal: explicitEntities.some((e) => e.field === 'goal'),
    decision: explicitEntities.some((e) => e.field === 'decision'),
  };

  // --- 2. Candidate memory retrieval ---
  const searchLimit = Math.min(MAX_CANDIDATE_POOL, budget.maxMemories * CANDIDATE_OVERSAMPLE_FACTOR);
  const searchResult = await searchMemories(db, userId, {
    query: input.query,
    limit: searchLimit,
    includeArchived: false,
    occurredAfter: effectiveOccurredAfter,
    occurredBefore: effectiveOccurredBefore,
    logger: deps.logger,
  });

  const searchedMemoryIds = new Set(searchResult.results.map((r) => r.memory.id));
  const explicitLinkedCandidates: RetrievedMemory[] = [];
  const now = new Date();
  for (const { entity } of explicitEntities) {
    const linked = await getSupportingMemories(db, userId, entity.id);
    for (const memory of linked) {
      if (searchedMemoryIds.has(memory.id)) continue;
      if (explicitLinkedCandidates.some((c) => c.memory.id === memory.id)) continue;
      const referenceDate = memory.occurredAt ?? memory.createdAt;
      if (effectiveOccurredAfter && referenceDate < effectiveOccurredAfter) continue;
      if (effectiveOccurredBefore && referenceDate > effectiveOccurredBefore) continue;

      const signals: RankingSignals = {
        semanticSimilarity: 0,
        lexicalScore: 0,
        entityMatchScore: ENTITY_MATCH_DIRECT,
        recencyScore: computeRecencyScore(referenceDate, now),
        importanceScore: normalizeImportance(memory.importance),
        confidenceScore: Number(memory.confidence),
      };
      const matchedEntities: MatchedEntity[] = [{ id: entity.id, name: entity.name, entityType: entity.entityType, matchType: 'direct' }];
      const reasons = [`directly linked to the requested ${entity.entityType} "${entity.name}"`];
      if (signals.recencyScore >= 0.7) reasons.push('recent');
      if (signals.importanceScore >= 0.75) reasons.push('marked important');

      explicitLinkedCandidates.push({
        memory,
        score: computeRankScore(signals),
        signals,
        matchedEntities,
        matchReasons: reasons,
      });
    }
  }

  const allCandidates: RetrievedMemory[] = [...searchResult.results, ...explicitLinkedCandidates];
  allCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aDate = (a.memory.occurredAt ?? a.memory.createdAt).getTime();
    const bDate = (b.memory.occurredAt ?? b.memory.createdAt).getTime();
    if (bDate !== aDate) return bDate - aDate;
    return a.memory.id.localeCompare(b.memory.id);
  });
  const totalCandidateMemories = allCandidates.length;

  // --- 3. Diversity-aware selection within budget ---
  const selectedCandidates = selectDiverseByContent(allCandidates, budget.maxMemories, (c) => c.memory.content);
  const memoriesTruncated = totalCandidateMemories > selectedCandidates.length;

  const memoryItems: ContextMemoryItem[] = selectedCandidates.map((c) => {
    const { content, truncated } = truncateContent(c.memory.content, budget.maxContentCharsPerMemory);
    return {
      memoryId: c.memory.id,
      content,
      contentTruncated: truncated,
      memoryType: c.memory.memoryType,
      epistemicStatus: c.memory.epistemicStatus,
      epistemicTier: computeEpistemicTier(c.memory.epistemicStatus, Number(c.memory.confidence)),
      confidence: Number(c.memory.confidence),
      importance: c.memory.importance,
      occurredAt: c.memory.occurredAt ? c.memory.occurredAt.toISOString() : null,
      createdAt: c.memory.createdAt.toISOString(),
      sourceType: c.memory.source.sourceType,
      sourceId: c.memory.sourceId,
      score: c.score,
      signals: c.signals,
      matchedEntityIds: c.matchedEntities.map((e) => e.id),
      includedBecause: c.matchReasons,
    };
  });

  // --- 4. Entity focus set: query-detected (direct/expanded) union explicit targets ---
  const entityMap = new Map<string, FocusEntity>();
  function upsertEntity(e: { id: string; name: string; entityType: EntityType }, matchType: FocusEntity['matchType'], hopDistance: number) {
    const existing = entityMap.get(e.id);
    if (!existing || MATCH_TYPE_RANK[matchType] > MATCH_TYPE_RANK[existing.matchType] || hopDistance < existing.hopDistance) {
      entityMap.set(e.id, { id: e.id, name: e.name, entityType: e.entityType, matchType, hopDistance });
    }
  }

  for (const me of searchResult.matchedEntities) {
    upsertEntity(me, me.matchType, me.matchType === 'direct' ? 0 : 1);
  }
  for (const { entity } of explicitEntities) {
    upsertEntity(entity, 'target', 0);
  }

  // matchedEntityTypes for intent classification reflects what the request was actually ABOUT (target/direct), not graph-expanded byproducts.
  const matchedEntityTypesForIntent = [...entityMap.values()].filter((e) => e.matchType !== 'expanded').map((e) => e.entityType);

  // --- 5. Bounded graph expansion from every focus (hop-0) entity ---
  const focusEntityIds = [...entityMap.values()].filter((e) => e.hopDistance === 0).map((e) => e.id);
  for (const focusId of focusEntityIds) {
    const nodes = await traverseFromEntity(db, userId, focusId, { hops: graphHops });
    for (const node of nodes) {
      upsertEntity(node.entity, 'expanded', node.hopDistance);
    }
  }

  const totalCandidateEntities = entityMap.size;
  const sortedEntities = [...entityMap.values()].sort((a, b) => {
    if (MATCH_TYPE_RANK[b.matchType] !== MATCH_TYPE_RANK[a.matchType]) return MATCH_TYPE_RANK[b.matchType] - MATCH_TYPE_RANK[a.matchType];
    if (a.hopDistance !== b.hopDistance) return a.hopDistance - b.hopDistance;
    if (a.entityType !== b.entityType) return a.entityType.localeCompare(b.entityType);
    if (a.name !== b.name) return a.name.localeCompare(b.name);
    return a.id.localeCompare(b.id);
  });
  const selectedEntities = sortedEntities.slice(0, budget.maxEntities);
  const entitiesTruncated = totalCandidateEntities > selectedEntities.length;
  const includedEntityIds = new Set(selectedEntities.map((e) => e.id));

  // Phase 40: one batched query per distinct entityType among the
  // FINAL selected (post-truncation) entities — never per-entity, and
  // never for entities that didn't make the budget cut.
  const subtypeByEntityId = await getEntitySubtypesBatch(db, selectedEntities.map((e) => ({ id: e.id, entityType: e.entityType })));

  const entityItems: ContextEntityItem[] = selectedEntities.map((e) => ({
    entityId: e.id,
    entityType: e.entityType,
    name: e.name,
    matchType: e.matchType,
    hopDistance: e.hopDistance,
    subtype: subtypeByEntityId.get(e.id) ?? null,
  }));

  // --- 5b. Personal Model facts + Insights connected to the included
  // entities (Phase 17). Two batched queries, bounded by
  // includedEntityIds.size (already <= budget.maxEntities <= 50) — no
  // per-entity loop, no N+1. Reuses the exact rollup rows those
  // modules already maintain; nothing is recomputed or reinterpreted
  // here. Both exclude dismissed rows (dismissedAt IS NULL), matching
  // getCurrentModel/getCurrentInsights' own default-view filter, so a
  // context packet never resurfaces something the user hid. ---
  const entityNameById = new Map(selectedEntities.map((e) => [e.id, e.name]));

  const factRows =
    includedEntityIds.size > 0
      ? await db
          .select()
          .from(personalModelFacts)
          .where(
            and(
              eq(personalModelFacts.userId, userId),
              inArray(personalModelFacts.subjectEntityId, [...includedEntityIds]),
              isNull(personalModelFacts.dismissedAt),
            ),
          )
      : [];
  const totalCandidatePersonalModelFacts = factRows.length;
  const sortedFacts = [...factRows].sort((a, b) => {
    if (Number(b.confidence) !== Number(a.confidence)) return Number(b.confidence) - Number(a.confidence);
    return b.lastObservedAt.getTime() - a.lastObservedAt.getTime();
  });
  const selectedFacts = sortedFacts.slice(0, budget.maxPersonalModelFacts);
  const personalModelFactsTruncated = totalCandidatePersonalModelFacts > selectedFacts.length;

  const personalModelFactItems: ContextPersonalModelFactItem[] = selectedFacts.map((f) => {
    const entityName = f.subjectEntityId ? (entityNameById.get(f.subjectEntityId) ?? 'this') : 'this';
    return {
      factId: f.id,
      category: f.category as PersonalModelCategory,
      subjectEntityId: f.subjectEntityId,
      factText: f.factText,
      epistemicStatus: f.epistemicStatus,
      epistemicTier: computeEpistemicTier(f.epistemicStatus, Number(f.confidence)),
      confidence: Number(f.confidence),
      temporalState: f.temporalState as FactTemporalState,
      lastObservedAt: f.lastObservedAt.toISOString(),
      includedBecause: [`connects to "${entityName}", which this context is about`],
    };
  });

  const insightRows =
    includedEntityIds.size > 0
      ? await db
          .select()
          .from(insights)
          .where(
            and(
              eq(insights.userId, userId),
              inArray(insights.subjectEntityId, [...includedEntityIds]),
              isNull(insights.dismissedAt),
            ),
          )
      : [];
  const totalCandidateInsights = insightRows.length;
  const sortedInsights = [...insightRows].sort((a, b) => {
    if (Number(b.confidence) !== Number(a.confidence)) return Number(b.confidence) - Number(a.confidence);
    return b.lastObservedAt.getTime() - a.lastObservedAt.getTime();
  });
  const selectedInsights = sortedInsights.slice(0, budget.maxInsights);
  const insightsTruncated = totalCandidateInsights > selectedInsights.length;

  const insightItems: ContextInsightItem[] = selectedInsights.map((i) => {
    const entityName = i.subjectEntityId ? (entityNameById.get(i.subjectEntityId) ?? 'this') : 'this';
    return {
      insightId: i.id,
      insightType: i.insightType as InsightType,
      statusClass: i.statusClass as InsightStatusClass,
      temporalState: i.temporalState as InsightTemporalState,
      title: i.title,
      description: i.description,
      subjectEntityId: i.subjectEntityId,
      confidence: Number(i.confidence),
      lastObservedAt: i.lastObservedAt.toISOString(),
      includedBecause: [`connects to "${entityName}", which this context is about`],
    };
  });

  // --- 6. Relationships among the included (post-truncation) entities, one batched query ---
  const allRelationships: EntityRelationshipRow[] = await listRelationshipsAmongEntities(db, userId, [...includedEntityIds]);
  // Only keep edges fully explainable within this packet — both ends must be entities the packet actually describes.
  const explainableRelationships = allRelationships.filter(
    (r) => includedEntityIds.has(r.fromEntityId) && includedEntityIds.has(r.toEntityId),
  );
  const totalCandidateRelationships = explainableRelationships.length;

  const sortedRelationships = [...explainableRelationships].sort((a, b) => {
    const tierA = EPISTEMIC_TIER_RANK[computeEpistemicTier(a.epistemicStatus, Number(a.confidence))];
    const tierB = EPISTEMIC_TIER_RANK[computeEpistemicTier(b.epistemicStatus, Number(b.confidence))];
    if (tierB !== tierA) return tierB - tierA;
    if (Number(b.confidence) !== Number(a.confidence)) return Number(b.confidence) - Number(a.confidence);
    if (b.updatedAt.getTime() !== a.updatedAt.getTime()) return b.updatedAt.getTime() - a.updatedAt.getTime();
    return a.id.localeCompare(b.id);
  });
  const selectedRelationships = sortedRelationships.slice(0, budget.maxRelationships);
  const relationshipsTruncated = totalCandidateRelationships > selectedRelationships.length;

  // --- 7. Evidence for the selected relationships, one batched query ---
  const relationshipIds = selectedRelationships.map((r) => r.id);
  const evidenceRows = await getRelationshipEvidenceBatch(db, userId, relationshipIds);
  const evidenceByRelationship = new Map<string, typeof evidenceRows>();
  for (const row of evidenceRows) {
    const list = evidenceByRelationship.get(row.relationshipId) ?? [];
    list.push(row);
    evidenceByRelationship.set(row.relationshipId, list);
  }

  const relationshipItems: ContextRelationshipItem[] = selectedRelationships.map((rel) => {
    const evidenceForRel = (evidenceByRelationship.get(rel.id) ?? [])
      .slice()
      .sort((a, b) => (b.createdAt.getTime() !== a.createdAt.getTime() ? b.createdAt.getTime() - a.createdAt.getTime() : a.id.localeCompare(b.id)));
    const evidenceTruncated = evidenceForRel.length > budget.maxEvidencePerRelationship;
    const evidenceItems: ContextEvidenceItem[] = evidenceForRel.slice(0, budget.maxEvidencePerRelationship).map((e) => ({
      evidenceId: e.id,
      memoryId: e.memoryId,
      evidenceText: e.evidenceText,
      epistemicStatus: e.epistemicStatus,
      epistemicTier: computeEpistemicTier(e.epistemicStatus, Number(e.confidence)),
      confidence: Number(e.confidence),
      extractionMethod: e.extractionMethod,
      createdAt: e.createdAt.toISOString(),
    }));

    return {
      relationshipId: rel.id,
      fromEntityId: rel.fromEntityId,
      toEntityId: rel.toEntityId,
      relationshipType: rel.relationshipType,
      epistemicStatus: rel.epistemicStatus,
      epistemicTier: computeEpistemicTier(rel.epistemicStatus, Number(rel.confidence)),
      confidence: Number(rel.confidence),
      createdAt: rel.createdAt.toISOString(),
      updatedAt: rel.updatedAt.toISOString(),
      evidence: evidenceItems,
      evidenceTruncated,
    };
  });

  // --- 8. Conflict detection (structural only — see conflicts.ts) ---
  const conflicts: ContextConflict[] = detectRelationshipConflicts(
    relationshipItems.map((r) => ({
      relationshipId: r.relationshipId,
      fromEntityId: r.fromEntityId,
      relationshipType: r.relationshipType,
      toEntityId: r.toEntityId,
    })),
  );

  // --- 9. Intent classification (deterministic by default; see intent.ts) ---
  const intentResult = await intentClassifier.classify({
    query: input.query,
    matchedEntityTypes: matchedEntityTypesForIntent,
    explicitTargets,
  });

  // --- 10. Truncation info + rough size estimate ---
  const estimatedTokens =
    memoryItems.reduce((sum, m) => sum + estimateTokens(m.content), 0) +
    relationshipItems.reduce((sum, r) => sum + r.evidence.reduce((s, e) => s + estimateTokens(e.evidenceText ?? ''), 0), 0);

  return {
    version: CONTEXT_PACKET_VERSION,
    query: input.query,
    intent: intentResult.intent,
    intentConfidence: intentResult.confidence,
    intentSignals: temporalSignal ? [...intentResult.signals, temporalSignal] : intentResult.signals,
    generatedAt: new Date().toISOString(),
    memories: memoryItems,
    entities: entityItems,
    relationships: relationshipItems,
    personalModelFacts: personalModelFactItems,
    insights: insightItems,
    conflicts,
    budget,
    truncation: {
      memoriesTruncated,
      entitiesTruncated,
      relationshipsTruncated,
      totalCandidateMemories,
      totalCandidateEntities,
      totalCandidateRelationships,
      personalModelFactsTruncated,
      totalCandidatePersonalModelFacts,
      insightsTruncated,
      totalCandidateInsights,
      estimatedTokens,
    },
  };
}
