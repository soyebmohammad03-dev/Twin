import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { entities, memoryEntities, memories, type Queryable } from '@twin/db';
import type { EntityType, PersonalModelCategory, FactTemporalState } from '@twin/contracts';
import { listRelationshipsAmongEntities, getRelationshipEvidenceBatch } from '../graph/relationships.service.js';
import { CATEGORY_TO_ENTITY_TYPE, PERSONAL_MODEL_CATEGORIES } from './categories.js';
import { aggregateConfidence, strongestEpistemicStatus } from './confidence.js';
import { computeStability } from './stability.js';
import { computeTemporalState } from './temporal.js';
import { extractPreferenceMatches, extractConstraintMatches } from './textSignals.js';
import { detectRelationshipConflicts, detectPreferenceConflicts } from './conflicts.js';
import { distinctObservationCount, type FactCandidate, type Observation } from './observations.js';

/**
 * Item 24's explicit bounds — a rebuild scans a bounded slice of a
 * user's data, not their entire history. Documented, not tuned:
 * generous enough to cover realistic usage at this project's current
 * scale, small enough to keep a rebuild a single bounded batch of
 * queries rather than an unbounded scan.
 */
export const MAX_ENTITIES_SCANNED = 500;
export const MAX_MEMORIES_SCANNED = 300;
export const RECURRING_TOPIC_MIN_MENTIONS = 3;
export const HIGH_IMPORTANCE_THRESHOLD = 4;

const GROUNDED_ENTITY_TYPES: EntityType[] = ['person', 'project', 'goal', 'decision', 'idea'];

interface RawEntity {
  id: string;
  entityType: EntityType;
  name: string;
}

interface RawMention {
  entityId: string;
  memoryId: string;
  epistemicStatus: Observation['epistemicStatus'];
  confidence: string;
  occurredAt: Date | null;
  createdAt: Date;
}

interface RawMemory {
  id: string;
  content: string;
  epistemicStatus: Observation['epistemicStatus'];
  confidence: string;
  importance: number;
  occurredAt: Date | null;
  createdAt: Date;
}

function refDate(occurredAt: Date | null, createdAt: Date): Date {
  return occurredAt ?? createdAt;
}

function mentionToObservation(m: RawMention): Observation {
  return {
    epistemicStatus: m.epistemicStatus,
    confidence: Number(m.confidence),
    observedAt: refDate(m.occurredAt, m.createdAt),
    evidenceSource: 'memory',
    memoryId: m.memoryId,
    relationshipId: null,
    entityId: m.entityId,
    evidenceText: null,
  };
}

const CATEGORY_VERB: Partial<Record<PersonalModelCategory, string>> = {
  important_people: "You've mentioned {name} in your memories.",
  active_projects: 'You appear to be working on {name}.',
  goals: '{name} is a goal you appear to be tracking.',
  decisions: '{name} is a decision you’ve been considering.',
  knowledge_areas: "You've explored the topic of {name}.",
};

function factTextForEntity(category: PersonalModelCategory, name: string): string {
  const template = CATEGORY_VERB[category] ?? '{name}';
  return template.replace('{name}', name);
}

/**
 * Builds every FactCandidate groundable in the given (bounded) data —
 * pure with respect to its inputs (no DB access itself), so it's
 * directly unit-testable with hand-built fixtures. The DB-touching
 * `rebuildPersonalModel` below is a thin wrapper that fetches bounded
 * data and delegates here.
 */
export interface FactCandidateResult {
  candidates: FactCandidate[];
  /** `${category}::${subjectKey}` keys whose evidence was superseded by a newer, conflicting candidate — computed once here so callers never need to re-run conflict detection. */
  supersededKeys: Set<string>;
}

export function buildFactCandidates(input: {
  entities: RawEntity[];
  mentions: RawMention[];
  relationships: { relationshipId: string; fromEntityId: string; toEntityId: string; relationshipType: string }[];
  relationshipEvidence: {
    relationshipId: string;
    memoryId: string;
    epistemicStatus: Observation['epistemicStatus'];
    confidence: string;
    createdAt: Date;
    evidenceText: string | null;
  }[];
  recentMemories: RawMemory[];
  now: Date;
}): FactCandidateResult {
  const candidates: FactCandidate[] = [];
  const entityById = new Map(input.entities.map((e) => [e.id, e]));

  // --- Entity-grounded categories (important_people, active_projects, goals, decisions, knowledge_areas) ---
  const mentionsByEntity = new Map<string, RawMention[]>();
  for (const m of input.mentions) {
    const list = mentionsByEntity.get(m.entityId) ?? [];
    list.push(m);
    mentionsByEntity.set(m.entityId, list);
  }

  // Relationship evidence, grouped by the relationship it supports, and rolled up to each endpoint entity.
  const relationshipById = new Map(input.relationships.map((r) => [r.relationshipId, r]));
  const evidenceByEntity = new Map<string, Observation[]>();
  for (const ev of input.relationshipEvidence) {
    const rel = relationshipById.get(ev.relationshipId);
    if (!rel) continue;
    const obs: Observation = {
      epistemicStatus: ev.epistemicStatus,
      confidence: Number(ev.confidence),
      observedAt: ev.createdAt,
      evidenceSource: 'relationship',
      memoryId: ev.memoryId,
      relationshipId: ev.relationshipId,
      entityId: null,
      evidenceText: ev.evidenceText,
    };
    for (const endpointId of [rel.fromEntityId, rel.toEntityId]) {
      const list = evidenceByEntity.get(endpointId) ?? [];
      list.push(obs);
      evidenceByEntity.set(endpointId, list);
    }
  }

  // Relationship conflicts (currently applied to active_projects: same person, same relationship type, different project).
  const relationshipConflicts = detectRelationshipConflicts(
    input.relationships.map((r) => ({
      relationshipId: r.relationshipId,
      fromEntityId: r.fromEntityId,
      relationshipType: r.relationshipType,
      toEntityId: r.toEntityId,
      lastObservedAt:
        input.relationshipEvidence
          .filter((e) => e.relationshipId === r.relationshipId)
          .reduce<Date | null>((latest, e) => (!latest || e.createdAt > latest ? e.createdAt : latest), null) ?? input.now,
    })),
  );
  // A project entity is "in conflict" if ANY relationship pointing at it (as toEntity) is part of a conflict group.
  const conflictedProjectEntityIds = new Set<string>();
  const supersededProjectEntityIds = new Set<string>();
  for (const rel of input.relationships) {
    if (relationshipConflicts.conflictsByRelationshipId.has(rel.relationshipId)) {
      conflictedProjectEntityIds.add(rel.toEntityId);
      if (relationshipConflicts.supersededByNewer.get(rel.relationshipId)) {
        supersededProjectEntityIds.add(rel.toEntityId);
      }
    }
  }

  for (const category of PERSONAL_MODEL_CATEGORIES) {
    const entityType = CATEGORY_TO_ENTITY_TYPE[category];
    if (!entityType) continue;

    for (const entity of input.entities) {
      if (entity.entityType !== entityType) continue;
      const mentionObs = (mentionsByEntity.get(entity.id) ?? []).map(mentionToObservation);
      const relObs = evidenceByEntity.get(entity.id) ?? [];
      const observations = [...mentionObs, ...relObs];
      if (observations.length === 0) continue; // item 23: never a fact without evidence

      const hasConflict = category === 'active_projects' && conflictedProjectEntityIds.has(entity.id);
      candidates.push({
        category,
        subjectKey: entity.id,
        subjectEntityId: entity.id,
        factText: factTextForEntity(category, entity.name),
        observations,
        conflictGroupKey: hasConflict ? `project-conflict:${entity.id}` : null,
      });
    }
  }

  // --- recurring_topics: any grounded entity mentioned across >= N distinct memories ---
  for (const entity of input.entities) {
    const mentionObs = (mentionsByEntity.get(entity.id) ?? []).map(mentionToObservation);
    if (distinctObservationCount(mentionObs) < RECURRING_TOPIC_MIN_MENTIONS) continue;
    candidates.push({
      category: 'recurring_topics',
      subjectKey: entity.id,
      subjectEntityId: entity.id,
      factText: `${entity.name} comes up repeatedly in your memories.`,
      observations: mentionObs,
      conflictGroupKey: null,
    });
  }

  // --- preferences / constraints: regex-derived from recent memory content ---
  const preferenceGroups = new Map<string, { subject: string; sentiment: 'positive' | 'negative'; observations: Observation[] }>();
  const constraintGroups = new Map<string, { subject: string; observations: Observation[] }>();

  for (const memory of input.recentMemories) {
    for (const match of extractPreferenceMatches(memory.content)) {
      const obs: Observation = {
        epistemicStatus: memory.epistemicStatus,
        confidence: match.hedged ? Math.min(Number(memory.confidence), 0.4) : Number(memory.confidence),
        observedAt: refDate(memory.occurredAt, memory.createdAt),
        evidenceSource: 'memory',
        memoryId: memory.id,
        relationshipId: null,
        entityId: null,
        evidenceText: match.matchedText,
      };
      const group = preferenceGroups.get(match.fullPhrase) ?? { subject: match.subject, sentiment: match.sentiment, observations: [] };
      group.observations.push(obs);
      preferenceGroups.set(match.fullPhrase, group);
    }
    for (const match of extractConstraintMatches(memory.content)) {
      const obs: Observation = {
        epistemicStatus: memory.epistemicStatus,
        confidence: match.hedged ? Math.min(Number(memory.confidence), 0.4) : Number(memory.confidence),
        observedAt: refDate(memory.occurredAt, memory.createdAt),
        evidenceSource: 'memory',
        memoryId: memory.id,
        relationshipId: null,
        entityId: null,
        evidenceText: match.matchedText,
      };
      const group = constraintGroups.get(match.fullPhrase) ?? { subject: match.subject, observations: [] };
      group.observations.push(obs);
      constraintGroups.set(match.fullPhrase, group);
    }
  }

  const preferenceConflicts = detectPreferenceConflicts(
    [...preferenceGroups.entries()].map(([factSubjectKey, g]) => ({ factSubjectKey, subject: g.subject, sentiment: g.sentiment })),
  );

  for (const [fullPhrase, group] of preferenceGroups) {
    const verb = group.sentiment === 'positive' ? 'like' : 'dislike';
    candidates.push({
      category: 'preferences',
      subjectKey: fullPhrase,
      subjectEntityId: null,
      factText: `You ${verb} ${group.subject}.`,
      observations: group.observations,
      conflictGroupKey: preferenceConflicts.get(fullPhrase) ? `preference-conflict:${group.subject}` : null,
    });
  }
  for (const [fullPhrase, group] of constraintGroups) {
    candidates.push({
      category: 'constraints',
      subjectKey: fullPhrase,
      subjectEntityId: null,
      factText: `You have a constraint around ${group.subject}.`,
      observations: group.observations,
      conflictGroupKey: null,
    });
  }

  // --- current_priorities: high-importance memories, anchored to an entity where possible ---
  const mentionedEntitiesByMemory = new Map<string, string[]>();
  for (const m of input.mentions) {
    const list = mentionedEntitiesByMemory.get(m.memoryId) ?? [];
    list.push(m.entityId);
    mentionedEntitiesByMemory.set(m.memoryId, list);
  }
  for (const memory of input.recentMemories) {
    if (memory.importance < HIGH_IMPORTANCE_THRESHOLD) continue;
    const linkedEntityIds = mentionedEntitiesByMemory.get(memory.id) ?? [];
    const [firstEntityId] = linkedEntityIds;
    const subjectKey = firstEntityId ? `priority:${firstEntityId}` : `priority:memory:${memory.id}`;
    const anchorName = firstEntityId ? entityById.get(firstEntityId)?.name : undefined;
    const obs: Observation = {
      epistemicStatus: memory.epistemicStatus,
      confidence: Number(memory.confidence),
      observedAt: refDate(memory.occurredAt, memory.createdAt),
      evidenceSource: 'memory',
      memoryId: memory.id,
      relationshipId: null,
      entityId: firstEntityId ?? null,
      evidenceText: null,
    };
    candidates.push({
      category: 'current_priorities',
      subjectKey,
      subjectEntityId: firstEntityId ?? null,
      factText: anchorName ? `${anchorName} is a current priority.` : truncateForFactText(memory.content),
      observations: [obs],
      conflictGroupKey: null,
    });
  }

  const merged = mergeCandidatesBySubject(candidates);
  const supersededKeys = new Set(
    merged
      .filter((c) => c.category === 'active_projects' && c.subjectEntityId && supersededProjectEntityIds.has(c.subjectEntityId))
      .map((c) => `${c.category}::${c.subjectKey}`),
  );
  return { candidates: merged, supersededKeys };
}

function truncateForFactText(content: string): string {
  const trimmed = content.trim();
  return trimmed.length <= 80 ? trimmed : `${trimmed.slice(0, 77)}…`;
}

/** current_priorities can produce multiple candidates for the same subjectKey (two high-importance memories about the same entity) — merge them like every other category before building fact rows. */
function mergeCandidatesBySubject(candidates: FactCandidate[]): FactCandidate[] {
  const byKey = new Map<string, FactCandidate>();
  for (const c of candidates) {
    const key = `${c.category}::${c.subjectKey}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...c, observations: [...c.observations] });
      continue;
    }
    existing.observations.push(...c.observations);
  }
  return [...byKey.values()];
}

export interface ComputedFact {
  category: PersonalModelCategory;
  subjectKey: string;
  subjectEntityId: string | null;
  factText: string;
  epistemicStatus: Observation['epistemicStatus'];
  confidence: number;
  stability: 'one_off' | 'stable' | 'changing';
  // Reuses the contract's full FactTemporalState even though this
  // deterministic engine only ever emits current/historical/superseded/
  // unresolved itself — 'outdated' is exclusively a manual-correction
  // outcome (see personalModelService.ts's correctFact), never computed
  // here. Kept as one type rather than a narrower local union so the
  // two can't silently drift apart again.
  temporalState: FactTemporalState;
  firstObservedAt: Date;
  lastObservedAt: Date;
  observationCount: number;
  observations: Observation[];
}

/** Turns a FactCandidate into its final computed rollup fields. Pure and deterministic — same candidate + same `now` always produces the same ComputedFact. */
export function computeFact(candidate: FactCandidate, now: Date, supersededByNewer: boolean): ComputedFact {
  const observationCount = distinctObservationCount(candidate.observations);
  const hasConflict = candidate.conflictGroupKey !== null;
  const firstObservedAt = candidate.observations.reduce((min, o) => (o.observedAt < min ? o.observedAt : min), candidate.observations[0]!.observedAt);
  const lastObservedAt = candidate.observations.reduce((max, o) => (o.observedAt > max ? o.observedAt : max), candidate.observations[0]!.observedAt);

  return {
    category: candidate.category as PersonalModelCategory,
    subjectKey: candidate.subjectKey,
    subjectEntityId: candidate.subjectEntityId,
    factText: candidate.factText,
    epistemicStatus: strongestEpistemicStatus(candidate.observations),
    confidence: aggregateConfidence(candidate.observations),
    stability: computeStability(observationCount, hasConflict),
    temporalState: computeTemporalState(lastObservedAt, now, { supersededByNewer }),
    firstObservedAt,
    lastObservedAt,
    observationCount,
    observations: candidate.observations,
  };
}

// ---------------------------------------------------------------------------
// DB-touching data fetch (bounded) — thin wrapper around buildFactCandidates
// ---------------------------------------------------------------------------

export async function fetchModelInputs(
  db: Queryable,
  userId: string,
  now: Date,
): Promise<Parameters<typeof buildFactCandidates>[0]> {
  const entityRows = await db
    .select({ id: entities.id, entityType: entities.entityType, name: entities.name })
    .from(entities)
    .where(and(eq(entities.userId, userId), isNull(entities.archivedAt), inArray(entities.entityType, GROUNDED_ENTITY_TYPES)))
    .orderBy(desc(entities.createdAt))
    .limit(MAX_ENTITIES_SCANNED);

  const entityIds = entityRows.map((e) => e.id);

  const mentionRows: RawMention[] =
    entityIds.length === 0
      ? []
      : await db
          .select({
            entityId: memoryEntities.entityId,
            memoryId: memories.id,
            epistemicStatus: memories.epistemicStatus,
            confidence: memories.confidence,
            occurredAt: memories.occurredAt,
            createdAt: memories.createdAt,
          })
          .from(memoryEntities)
          .innerJoin(memories, eq(memoryEntities.memoryId, memories.id))
          .where(and(eq(memories.userId, userId), isNull(memories.deletedAt), inArray(memoryEntities.entityId, entityIds)));

  const relationshipRows = entityIds.length === 0 ? [] : await listRelationshipsAmongEntities(db, userId, entityIds);
  const relationshipIds = relationshipRows.map((r) => r.id);
  const relationshipEvidenceRows = relationshipIds.length === 0 ? [] : await getRelationshipEvidenceBatch(db, userId, relationshipIds);

  const recentMemoryRows: RawMemory[] = await db
    .select({
      id: memories.id,
      content: memories.content,
      epistemicStatus: memories.epistemicStatus,
      confidence: memories.confidence,
      importance: memories.importance,
      occurredAt: memories.occurredAt,
      createdAt: memories.createdAt,
    })
    .from(memories)
    .where(and(eq(memories.userId, userId), isNull(memories.deletedAt)))
    .orderBy(desc(memories.createdAt))
    .limit(MAX_MEMORIES_SCANNED);

  return {
    entities: entityRows,
    mentions: mentionRows,
    relationships: relationshipRows.map((r) => ({
      relationshipId: r.id,
      fromEntityId: r.fromEntityId,
      toEntityId: r.toEntityId,
      relationshipType: r.relationshipType,
    })),
    relationshipEvidence: relationshipEvidenceRows.map((e) => ({
      relationshipId: e.relationshipId,
      memoryId: e.memoryId,
      epistemicStatus: e.epistemicStatus,
      confidence: e.confidence,
      createdAt: e.createdAt,
      evidenceText: e.evidenceText,
    })),
    recentMemories: recentMemoryRows,
    now,
  };
}

/** The full, deterministic candidate-building pipeline given bounded live data — fetch + build + compute, no writes. Exposed so the write-path (personalModelStore.ts) and tests can share it without duplicating the fetch/compute wiring. */
export async function computeFactsForUser(db: Queryable, userId: string, now: Date = new Date()): Promise<ComputedFact[]> {
  const inputs = await fetchModelInputs(db, userId, now);
  const { candidates, supersededKeys } = buildFactCandidates(inputs);
  return candidates.map((c) => computeFact(c, now, supersededKeys.has(`${c.category}::${c.subjectKey}`)));
}
