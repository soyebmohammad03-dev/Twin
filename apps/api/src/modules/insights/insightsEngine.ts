import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { entities, goals, memoryEntities, memories, type Queryable } from '@twin/db';
import type { InsightType, InsightStatusClass, InsightTemporalState, EpistemicStatus } from '@twin/contracts';
import {
  MAX_GOALS_SCANNED,
  MAX_EVIDENCE_MEMORIES_PER_INSIGHT,
  NEGLECTED_GOAL_STALENESS_DAYS,
  RESOLVED_GOAL_STATUSES,
  SUPERSEDED_FACT_TEMPORAL_STATES,
  MAX_RELATIONSHIP_SCAN_ENTITIES,
  MAX_RELATIONSHIP_TENSION_SIDES,
  MAX_EVIDENCE_MEMORIES_PER_RELATIONSHIP_SIDE,
  RELATIONSHIP_TENSION_RESOLUTION_DAYS,
  MIN_SYNTHESIS_SOURCES,
  MIN_DISTINCT_SOURCE_TYPES,
  MAX_SYNTHESIS_SOURCES,
  MAX_SYNTHESIS_SOURCE_AGE_DAYS,
  MIN_SYNTHESIS_SOURCE_CONFIDENCE,
} from './categories.js';
import {
  computeNeglectedGoalConfidence,
  computeRecurringTopicConfidence,
  computePriorityTensionConfidence,
  computeRelationshipTensionConfidence,
  computeCrossInsightConfidence,
} from './confidence.js';
import {
  computeNeglectedGoalTemporalState,
  computeRecurringTopicTemporalState,
  computePriorityTensionTemporalState,
  computeRelationshipTensionTemporalState,
  isRelationshipTensionResolved,
  computeCrossInsightTemporalState,
} from './temporal.js';
import { getCurrentModel } from '../personalModel/personalModelService.js';
import { detectRelationshipConflicts } from '../personalModel/conflicts.js';
import { listRelationshipsAmongEntities, getRelationshipEvidenceBatch } from '../graph/relationships.service.js';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * The generic evidence shape every insight detector produces —
 * generalized from Phase 10's neglected-goal-specific
 * `evidenceMemories` array. Each variant's `observedAt` is always a
 * real, already-stored timestamp (a memory's occurredAt/createdAt, a
 * Personal Model fact's own lastObservedAt, or a relationship's own
 * evidence timestamp) — never invented. 'relationship' (Phase 12)
 * points at a real entity_relationships row; its `text` is a
 * templated-from-real-names description, exactly like every other
 * insight's title/description are templated, never fabricated content.
 * `supersededAt` (Phase 13, optional, only ever populated by
 * relationship_tension's builder) marks when this specific evidence
 * item stopped being the current claim — the group's CURRENT side's
 * own firstObservedAt. Never set by any other detector; the underlying
 * insight_evidence.supersededAt column and the frontend's rendering of
 * it have existed unused since Phase 10.
 */
export type EvidenceItem =
  | { evidenceType: 'entity'; entityId: string; text: string | null; observedAt: Date }
  | { evidenceType: 'memory'; memoryId: string; text: string | null; observedAt: Date; supersededAt?: Date | null }
  | { evidenceType: 'personal_model_fact'; personalModelFactId: string; text: string | null; observedAt: Date }
  | { evidenceType: 'relationship'; relationshipId: string; text: string | null; observedAt: Date; supersededAt?: Date | null }
  | { evidenceType: 'insight'; sourceInsightId: string; text: string | null; observedAt: Date };

/** The generic candidate shape every insight detector produces — generalized from Phase 10's NeglectedGoalCandidate. */
export interface InsightCandidate {
  insightType: InsightType;
  subjectKey: string;
  statusClass: InsightStatusClass;
  temporalState: InsightTemporalState;
  title: string;
  description: string;
  confidence: number;
  subjectEntityId: string | null;
  firstObservedAt: Date;
  lastObservedAt: Date;
  observationCount: number;
  evidence: EvidenceItem[];
}

interface RawGoal {
  entityId: string;
  name: string;
  createdAt: Date;
}

interface RawMention {
  entityId: string;
  memoryId: string;
  content: string;
  occurredAt: Date | null;
  createdAt: Date;
}

function refDate(occurredAt: Date | null, createdAt: Date): Date {
  return occurredAt ?? createdAt;
}

/** A short, deterministic, truncated excerpt of the memory's own content — never a fabricated summary. Word-boundary-safe, same spirit as context/budget.ts's truncateContent. */
function excerpt(content: string, maxChars = 140): string {
  if (content.length <= maxChars) return content;
  const cut = content.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > 40 ? cut.slice(0, lastSpace) : cut}…`;
}

// ---------------------------------------------------------------------------
// neglected_goal — unchanged detection logic from Phase 10, generalized only
// to emit the shared InsightCandidate/EvidenceItem shape.
// ---------------------------------------------------------------------------

/**
 * Pure candidate-building logic — no DB access, directly unit
 * testable with hand-built fixtures. Mirrors
 * personalModel/personalModelEngine.ts's buildFactCandidates /
 * fetchModelInputs split.
 */
export function buildNeglectedGoalCandidates(input: { goals: RawGoal[]; mentions: RawMention[] }, now: Date): InsightCandidate[] {
  const mentionsByGoal = new Map<string, RawMention[]>();
  for (const m of input.mentions) {
    const list = mentionsByGoal.get(m.entityId) ?? [];
    list.push(m);
    mentionsByGoal.set(m.entityId, list);
  }

  const candidates: InsightCandidate[] = [];
  for (const goal of input.goals) {
    const mentions = (mentionsByGoal.get(goal.entityId) ?? []).sort(
      (a, b) => refDate(b.occurredAt, b.createdAt).getTime() - refDate(a.occurredAt, a.createdAt).getTime(),
    );

    const newestMention = mentions[0];
    const oldestMention = mentions[mentions.length - 1];
    const lastObservedAt = newestMention ? refDate(newestMention.occurredAt, newestMention.createdAt) : goal.createdAt;
    const firstObservedAt = oldestMention ? refDate(oldestMention.occurredAt, oldestMention.createdAt) : goal.createdAt;
    const daysSinceLastEvidence = (now.getTime() - lastObservedAt.getTime()) / MS_PER_DAY;

    if (daysSinceLastEvidence < NEGLECTED_GOAL_STALENESS_DAYS) continue;

    const roundedDays = Math.floor(daysSinceLastEvidence);
    const description =
      mentions.length > 0
        ? `No memories have mentioned "${goal.name}" in ${roundedDays} days (last mentioned ${lastObservedAt.toISOString().slice(0, 10)}).`
        : `"${goal.name}" was recorded as a goal but has never been mentioned in any memory since (created ${roundedDays} days ago).`;

    const evidence: EvidenceItem[] = [{ evidenceType: 'entity', entityId: goal.entityId, text: null, observedAt: firstObservedAt }];
    for (const m of mentions.slice(0, MAX_EVIDENCE_MEMORIES_PER_INSIGHT)) {
      evidence.push({ evidenceType: 'memory', memoryId: m.memoryId, text: excerpt(m.content), observedAt: refDate(m.occurredAt, m.createdAt) });
    }

    candidates.push({
      insightType: 'neglected_goal',
      subjectKey: goal.entityId,
      statusClass: 'unresolved',
      temporalState: computeNeglectedGoalTemporalState(daysSinceLastEvidence),
      title: `"${goal.name}" hasn't come up in a while`,
      description,
      confidence: computeNeglectedGoalConfidence({ evidenceCount: mentions.length, daysSinceLastEvidence }),
      subjectEntityId: goal.entityId,
      firstObservedAt,
      lastObservedAt,
      observationCount: mentions.length,
      evidence,
    });
  }

  return candidates;
}

/**
 * DB-touching wrapper: fetches a bounded slice of the user's goal
 * entities and their supporting memories, then delegates to the pure
 * builder above.
 *
 * Deliberately a LEFT JOIN against `goals`, not an INNER JOIN: no
 * code path in this repository currently writes a row into the 1:1
 * entity-subtype tables (goals/projects/people/decisions/events) when
 * an entity is created — entities exist with `entityType = 'goal'`
 * but an empty `goals` table, the same "unpopulated subtype table"
 * gap the Personal Model module explicitly worked around in Phase 9.
 * An INNER JOIN here would silently match zero rows for every real
 * user. `entities.entityType = 'goal'` is therefore the source of
 * truth for "is this a goal"; `goals.status` (when a subtype row
 * happens to exist) is used only to exclude explicitly resolved
 * goals, never to decide whether something is a goal at all.
 */
export async function computeNeglectedGoalInsights(db: Queryable, userId: string, now: Date = new Date()): Promise<InsightCandidate[]> {
  const goalRows = await db
    .select({ entityId: entities.id, name: entities.name, createdAt: entities.createdAt, status: goals.status })
    .from(entities)
    .leftJoin(goals, eq(goals.entityId, entities.id))
    .where(and(eq(entities.userId, userId), eq(entities.entityType, 'goal'), isNull(entities.archivedAt)))
    .orderBy(desc(entities.createdAt))
    .limit(MAX_GOALS_SCANNED);

  const activeGoalRows = goalRows.filter((g) => !g.status || !RESOLVED_GOAL_STATUSES.includes(g.status));
  const goalEntityIds = activeGoalRows.map((g) => g.entityId);

  const mentionRows: RawMention[] =
    goalEntityIds.length === 0
      ? []
      : await db
          .select({
            entityId: memoryEntities.entityId,
            memoryId: memories.id,
            content: memories.content,
            occurredAt: memories.occurredAt,
            createdAt: memories.createdAt,
          })
          .from(memoryEntities)
          .innerJoin(memories, eq(memoryEntities.memoryId, memories.id))
          .where(and(eq(memories.userId, userId), isNull(memories.deletedAt), inArray(memoryEntities.entityId, goalEntityIds)));

  return buildNeglectedGoalCandidates(
    { goals: activeGoalRows.map((g) => ({ entityId: g.entityId, name: g.name, createdAt: g.createdAt })), mentions: mentionRows },
    now,
  );
}

// ---------------------------------------------------------------------------
// recurring_topic and priority_tension — Phase 11. Both are derived
// PURELY from already-computed personal_model_facts rows (fetched
// once via getCurrentModel), never from a new memory/entity scan.
// ---------------------------------------------------------------------------

/** The slice of a personal_model_facts row both Phase 11 detectors need — mirrors the DB row shape (confidence as a numeric string) so the DB wrapper below can pass rows straight through with no reshaping. */
export interface RawPersonalModelFact {
  id: string;
  category: string;
  subjectKey: string;
  subjectEntityId: string | null;
  factText: string;
  epistemicStatus: EpistemicStatus;
  confidence: string;
  temporalState: string;
  firstObservedAt: Date;
  lastObservedAt: Date;
  observationCount: number;
}

/** Maps a Personal Model fact's own epistemicStatus to an insight statusClass — reuses already-stored data, no new heuristic. */
function statusClassForEpistemicStatus(status: EpistemicStatus): InsightStatusClass {
  if (status === 'explicit' || status === 'from_source') return 'observed';
  if (status === 'reported_by_other' || status === 'inferred') return 'inferred';
  return 'hypothesis';
}

/**
 * Pure — takes the already-fetched fact array (no DB access), so it's
 * directly unit testable with hand-built fixtures, same as the
 * neglected_goal builder above. Derives a recurring_topic insight from
 * each non-superseded personal_model_facts row in the 'recurring_topics'
 * category; that category's own >=3-distinct-memory threshold (see
 * personalModelEngine.ts's RECURRING_TOPIC_MIN_MENTIONS) already
 * enforces "if evidence is insufficient, do not generate the insight"
 * — this function never re-derives or second-guesses that threshold.
 */
export function buildRecurringTopicCandidates(facts: RawPersonalModelFact[], now: Date): InsightCandidate[] {
  const candidates: InsightCandidate[] = [];
  for (const fact of facts) {
    if (fact.category !== 'recurring_topics') continue;
    if (SUPERSEDED_FACT_TEMPORAL_STATES.includes(fact.temporalState)) continue;
    if (!fact.subjectEntityId) continue; // recurring_topics facts are always entity-grounded; defensive, never expected to trigger

    const isFading = fact.temporalState === 'historical';
    const temporalState = computeRecurringTopicTemporalState(fact.temporalState, fact.firstObservedAt, fact.lastObservedAt);
    const confidence = computeRecurringTopicConfidence({
      factConfidence: Number(fact.confidence),
      observationCount: fact.observationCount,
      isFading,
    });

    const lastSeenDate = fact.lastObservedAt.toISOString().slice(0, 10);
    const description = isFading
      ? `Mentioned ${fact.observationCount} times — used to come up often, but hasn't recently (last mentioned ${lastSeenDate}).`
      : `Mentioned ${fact.observationCount} times, most recently on ${lastSeenDate}.`;

    candidates.push({
      insightType: 'recurring_topic',
      subjectKey: fact.subjectEntityId,
      statusClass: statusClassForEpistemicStatus(fact.epistemicStatus),
      temporalState,
      title: fact.factText,
      description,
      confidence,
      subjectEntityId: fact.subjectEntityId,
      firstObservedAt: fact.firstObservedAt,
      lastObservedAt: fact.lastObservedAt,
      observationCount: fact.observationCount,
      evidence: [{ evidenceType: 'personal_model_fact', personalModelFactId: fact.id, text: fact.factText, observedAt: fact.lastObservedAt }],
    });
  }
  return candidates;
}

const PREFERENCE_SENTIMENT_PREFIX = /^(like|dislike):/;

/**
 * Pure — groups CURRENT (not historical/outdated/superseded)
 * 'preferences' facts by their bare subject (stripping the like:/
 * dislike: sentiment prefix personalModel/textSignals.ts already
 * encodes into subjectKey) and flags any subject with both a like:
 * and a dislike: fact still active as a tension. Deliberately
 * narrower than personalModel/conflicts.ts's detectPreferenceConflicts,
 * which runs over raw per-memory observations at a different stage —
 * operating over already-deduped current facts is simpler and
 * sufficient here. Only 'current' facts qualify: a stale or
 * user-corrected-away side means there is no LIVE tension (Phase 9.1's
 * "superseded evidence must not silently continue supporting a
 * current insight" rule, applied here as strictly as possible).
 */
export function buildPriorityTensionCandidates(facts: RawPersonalModelFact[], now: Date): InsightCandidate[] {
  const bySubject = new Map<string, { like?: RawPersonalModelFact; dislike?: RawPersonalModelFact }>();
  for (const fact of facts) {
    if (fact.category !== 'preferences' || fact.temporalState !== 'current') continue;
    const match = PREFERENCE_SENTIMENT_PREFIX.exec(fact.subjectKey);
    if (!match) continue;
    const sentiment = match[1] as 'like' | 'dislike';
    const bareSubject = fact.subjectKey.slice(match[0].length);
    const entry = bySubject.get(bareSubject) ?? {};
    entry[sentiment] = fact;
    bySubject.set(bareSubject, entry);
  }

  const candidates: InsightCandidate[] = [];
  for (const [bareSubject, { like, dislike }] of bySubject) {
    if (!like || !dislike) continue; // insufficient evidence — only one side present, no tension to report

    const firstObservedAt = like.firstObservedAt < dislike.firstObservedAt ? like.firstObservedAt : dislike.firstObservedAt;
    const lastObservedAt = like.lastObservedAt > dislike.lastObservedAt ? like.lastObservedAt : dislike.lastObservedAt;

    candidates.push({
      insightType: 'priority_tension',
      subjectKey: bareSubject,
      statusClass: 'tension',
      temporalState: computePriorityTensionTemporalState(firstObservedAt, now),
      title: `Mixed signals about "${bareSubject}"`,
      description: `You've said "${like.factText}" and also "${dislike.factText}" — these may be in tension.`,
      confidence: computePriorityTensionConfidence({ likeConfidence: Number(like.confidence), dislikeConfidence: Number(dislike.confidence) }),
      subjectEntityId: null,
      firstObservedAt,
      lastObservedAt,
      observationCount: like.observationCount + dislike.observationCount,
      evidence: [
        { evidenceType: 'personal_model_fact', personalModelFactId: like.id, text: like.factText, observedAt: like.lastObservedAt },
        { evidenceType: 'personal_model_fact', personalModelFactId: dislike.id, text: dislike.factText, observedAt: dislike.lastObservedAt },
      ],
    });
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// relationship_tension — Phase 12. Derived directly from the knowledge
// graph (entity_relationships + relationship_evidence), reusing
// personalModel/conflicts.ts's detectRelationshipConflicts rather than
// re-deriving conflict grouping here.
// ---------------------------------------------------------------------------

export interface RawRelationship {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  relationshipType: string;
  epistemicStatus: EpistemicStatus;
  confidence: string;
}

export interface RawRelationshipEvidence {
  relationshipId: string;
  memoryId: string | null;
  evidenceText: string | null;
  createdAt: Date;
}

/**
 * Pure — takes already-fetched relationships/evidence/entity-name data
 * (no DB access), directly unit testable, same shape as every other
 * detector above. `entityNames` is a plain lookup map so this stays
 * pure; the DB wrapper below builds it with one batched query.
 *
 * A relationship only becomes tension-evidence once it's flagged by
 * detectRelationshipConflicts — i.e. it shares (fromEntityId,
 * relationshipType) with at least one other CURRENTLY-existing
 * relationship pointing at a different toEntityId. This is a purely
 * structural signal (same fromEntity+type, different targets) and is
 * deliberately worded as non-committal in the generated title/
 * description — it may mean the relationship changed over time, or
 * that the evidence genuinely disagrees; this function does not (and
 * cannot, from this signal alone) decide which.
 */
export function buildRelationshipTensionCandidates(
  input: { relationships: RawRelationship[]; evidence: RawRelationshipEvidence[]; entityNames: Map<string, string> },
  now: Date,
): InsightCandidate[] {
  const evidenceByRelationship = new Map<string, RawRelationshipEvidence[]>();
  for (const e of input.evidence) {
    const list = evidenceByRelationship.get(e.relationshipId) ?? [];
    list.push(e);
    evidenceByRelationship.set(e.relationshipId, list);
  }

  // A relationship's own first/last-observed comes from its evidence
  // trail's timestamps (personalModelEngine.ts's established
  // convention — never entityRelationships.updatedAt), falling back to
  // `now` only for the pathological case of a relationship with no
  // evidence rows at all (never expected in practice, since
  // upsertRelationshipWithEvidence always writes one).
  const firstObservedByRelationship = new Map<string, Date>();
  const lastObservedByRelationship = new Map<string, Date>();
  for (const rel of input.relationships) {
    const evRows = evidenceByRelationship.get(rel.id) ?? [];
    let earliest: Date | null = null;
    let latest: Date | null = null;
    for (const e of evRows) {
      if (!earliest || e.createdAt < earliest) earliest = e.createdAt;
      if (!latest || e.createdAt > latest) latest = e.createdAt;
    }
    firstObservedByRelationship.set(rel.id, earliest ?? now);
    lastObservedByRelationship.set(rel.id, latest ?? now);
  }

  const conflicts = detectRelationshipConflicts(
    input.relationships.map((r) => ({
      relationshipId: r.id,
      fromEntityId: r.fromEntityId,
      relationshipType: r.relationshipType,
      toEntityId: r.toEntityId,
      lastObservedAt: lastObservedByRelationship.get(r.id)!,
    })),
  );

  const relById = new Map(input.relationships.map((r) => [r.id, r]));
  const entityName = (id: string) => input.entityNames.get(id) ?? 'This entity';

  const candidates: InsightCandidate[] = [];
  const processedGroups = new Set<string>();
  for (const rel of input.relationships) {
    const others = conflicts.conflictsByRelationshipId.get(rel.id);
    if (!others || others.length === 0) continue;
    const groupKey = `${rel.fromEntityId}::${rel.relationshipType}`;
    if (processedGroups.has(groupKey)) continue;
    processedGroups.add(groupKey);

    const allIds = [rel.id, ...others];
    const sorted = [...allIds].sort(
      (a, b) => lastObservedByRelationship.get(b)!.getTime() - lastObservedByRelationship.get(a)!.getTime(),
    );
    const currentId = sorted[0]!;
    // The FULL remaining group, uncapped — used for resolution below.
    // priorIds (capped at MAX_RELATIONSHIP_TENSION_SIDES) is only for
    // bounding how much evidence is attached; an older side excluded
    // from evidence display must still be able to keep a tension active
    // if it's recently reinforced.
    const allPriorIds = sorted.slice(1);
    const priorIds = allPriorIds.slice(0, MAX_RELATIONSHIP_TENSION_SIDES);
    const current = relById.get(currentId)!;
    const firstPrior = relById.get(priorIds[0]!)!;

    const resolved = isRelationshipTensionResolved(
      allPriorIds.map((id) => lastObservedByRelationship.get(id)!),
      now,
    );

    const fromName = entityName(current.fromEntityId);
    const currentToName = entityName(current.toEntityId);
    const firstPriorToName = entityName(firstPrior.toEntityId);

    const firstObservedAt = sorted.reduce(
      (min, id) => (firstObservedByRelationship.get(id)!.getTime() < min.getTime() ? firstObservedByRelationship.get(id)! : min),
      firstObservedByRelationship.get(currentId)!,
    );
    const lastObservedAt = lastObservedByRelationship.get(currentId)!;

    const confidence = computeRelationshipTensionConfidence({
      currentConfidence: Number(current.confidence),
      currentEpistemicStatus: current.epistemicStatus,
      priorConfidence: Number(firstPrior.confidence),
      priorEpistemicStatus: firstPrior.epistemicStatus,
    });

    // Deliberately non-committal wording, echoing context/conflicts.ts's
    // own established phrasing for this exact structural signal — the
    // evidence cannot distinguish "this changed over time" from
    // "this genuinely conflicts," so neither is asserted, resolved or not.
    const baseDescription =
      sorted.length > 2
        ? `Twin found ${sorted.length} different "${current.relationshipType}" relationships from ${fromName} — most recently to ${currentToName}, and ${sorted.length - 1} other(s) including ${firstPriorToName}. This may reflect a change over time or genuinely conflicting evidence; neither is assumed correct.`
        : `Twin found "${fromName} ${current.relationshipType} ${currentToName}" (most recent) alongside "${fromName} ${current.relationshipType} ${firstPriorToName}" (earlier). This may reflect a change over time or genuinely conflicting evidence; neither is assumed correct.`;

    // Phase 13: once resolved, say so in Twin's own terms (what Twin's
    // threshold decided), never as a claim about what actually happened
    // to the relationship — the underlying ambiguity is still
    // unresolved in principle, Twin has just stopped treating it as
    // actively contested due to prolonged silence on the older side(s).
    const description = resolved
      ? `${baseDescription} No new evidence has supported the earlier relationship${allPriorIds.length > 1 ? 's' : ''} in over ${RELATIONSHIP_TENSION_RESOLUTION_DAYS} days, so Twin no longer treats this as an active tension.`
      : baseDescription;

    const evidence: EvidenceItem[] = [];
    for (const id of [currentId, ...priorIds]) {
      const sideRel = relById.get(id)!;
      const toName = entityName(sideRel.toEntityId);
      // Every non-current side's evidence is marked superseded from the
      // moment the current side's own evidence trail began — regardless
      // of whether the tension AS A WHOLE has resolved yet. This lets a
      // user see, per side, "this is the current claim" vs "this is
      // historical" even while the insight is still an active tension.
      const supersededAt = id === currentId ? null : firstObservedByRelationship.get(currentId)!;
      evidence.push({
        evidenceType: 'relationship',
        relationshipId: id,
        text: `${fromName} ${sideRel.relationshipType} ${toName}`,
        observedAt: lastObservedByRelationship.get(id)!,
        supersededAt,
      });
      const sideEvidence = (evidenceByRelationship.get(id) ?? [])
        .slice()
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, MAX_EVIDENCE_MEMORIES_PER_RELATIONSHIP_SIDE);
      for (const e of sideEvidence) {
        if (!e.memoryId) continue;
        evidence.push({ evidenceType: 'memory', memoryId: e.memoryId, text: e.evidenceText, observedAt: e.createdAt, supersededAt });
      }
    }

    candidates.push({
      insightType: 'relationship_tension',
      subjectKey: groupKey,
      statusClass: 'tension',
      temporalState: computeRelationshipTensionTemporalState(firstObservedAt, now, resolved),
      title: `"${fromName}" has more than one "${current.relationshipType}" relationship on record`,
      description,
      confidence,
      subjectEntityId: current.fromEntityId,
      firstObservedAt,
      lastObservedAt,
      observationCount: sorted.length,
      evidence,
    });
  }

  candidates.sort((a, b) => a.subjectKey.localeCompare(b.subjectKey));
  return candidates;
}

/**
 * DB-touching wrapper: bounded entity scan → listRelationshipsAmongEntities
 * (one batched query) → getRelationshipEvidenceBatch (one batched
 * query) → one batched entity-name lookup for any endpoint entities
 * not already covered by the initial scan (e.g. a relationship target
 * outside the bounded set) — four queries total, none per-relationship,
 * no N+1. Delegates to the pure builder above.
 */
export async function computeRelationshipTensionInsights(db: Queryable, userId: string, now: Date = new Date()): Promise<InsightCandidate[]> {
  const entityRows = await db
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .where(and(eq(entities.userId, userId), isNull(entities.archivedAt)))
    .orderBy(desc(entities.createdAt))
    .limit(MAX_RELATIONSHIP_SCAN_ENTITIES);
  const entityIds = entityRows.map((e) => e.id);
  if (entityIds.length === 0) return [];

  const relationshipRows = await listRelationshipsAmongEntities(db, userId, entityIds);
  if (relationshipRows.length === 0) return [];

  const relationshipIds = relationshipRows.map((r) => r.id);
  const evidenceRows = await getRelationshipEvidenceBatch(db, userId, relationshipIds);

  const entityNames = new Map(entityRows.map((e) => [e.id, e.name]));
  const missingEntityIds = [
    ...new Set(relationshipRows.flatMap((r) => [r.fromEntityId, r.toEntityId]).filter((id) => !entityNames.has(id))),
  ];
  if (missingEntityIds.length > 0) {
    const extraRows = await db
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .where(and(eq(entities.userId, userId), inArray(entities.id, missingEntityIds)));
    for (const e of extraRows) entityNames.set(e.id, e.name);
  }

  return buildRelationshipTensionCandidates(
    {
      relationships: relationshipRows.map((r) => ({
        id: r.id,
        fromEntityId: r.fromEntityId,
        toEntityId: r.toEntityId,
        relationshipType: r.relationshipType,
        epistemicStatus: r.epistemicStatus,
        confidence: r.confidence,
      })),
      evidence: evidenceRows.map((e) => ({
        relationshipId: e.relationshipId,
        memoryId: e.memoryId,
        evidenceText: e.evidenceText,
        createdAt: e.createdAt,
      })),
      entityNames,
    },
    now,
  );
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * The single entry point insightsStore.ts's rebuild calls for
 * FIRST-ORDER insights. Fetches each detector's bounded input ONCE
 * (the goal+mention query for neglected_goal; one getCurrentModel call
 * shared by both Phase 11 detectors — no per-fact follow-up queries,
 * no N+1) and combines every candidate into one list for the store to
 * upsert. Deliberately does NOT include Phase 14's 'cross_insight' —
 * synthesis needs the REAL DB ids of its contributing sources, which
 * only exist after this function's own output has been upserted (see
 * insightsStore.ts's two-pass rebuild and computeCrossInsightInsights
 * below), and structurally can never synthesize from another
 * cross_insight this way.
 */
export async function computeAllInsightCandidates(db: Queryable, userId: string, now: Date = new Date()): Promise<InsightCandidate[]> {
  const [neglectedGoalCandidates, personalModelFacts, relationshipTensionCandidates] = await Promise.all([
    computeNeglectedGoalInsights(db, userId, now),
    getCurrentModel(db, userId),
    computeRelationshipTensionInsights(db, userId, now),
  ]);

  const rawFacts: RawPersonalModelFact[] = personalModelFacts.map((f) => ({
    id: f.id,
    category: f.category,
    subjectKey: f.subjectKey,
    subjectEntityId: f.subjectEntityId,
    factText: f.factText,
    epistemicStatus: f.epistemicStatus,
    confidence: f.confidence,
    temporalState: f.temporalState,
    firstObservedAt: f.firstObservedAt,
    lastObservedAt: f.lastObservedAt,
    observationCount: f.observationCount,
  }));

  return [
    ...neglectedGoalCandidates,
    ...buildRecurringTopicCandidates(rawFacts, now),
    ...buildPriorityTensionCandidates(rawFacts, now),
    ...relationshipTensionCandidates,
  ];
}

// ---------------------------------------------------------------------------
// cross_insight — Phase 14. Synthesizes a higher-order pattern from
// >=2 first-order insights (never from another cross_insight) that
// share a concrete anchor: the literal same entity, or — for
// priority_tension, which has no entity of its own — its normalized
// free-text subject phrase bridged to an entity's normalized name.
// Deterministic and conservative throughout: no LLM, no fuzzy
// matching, thresholds are named constants (categories.ts), and a
// synthesis is never more confident than its weakest source.
// ---------------------------------------------------------------------------

/** The minimal shape computeCrossInsightInsights/buildCrossInsightCandidates need from an already-upserted first-order insight row — deliberately narrow (not the full InsightRow) so the pure builder stays testable with hand-built fixtures. */
export interface SourceInsightForSynthesis {
  id: string;
  insightType: InsightType;
  subjectKey: string;
  subjectEntityId: string | null;
  title: string;
  confidence: number;
  /** Used only to exclude an already-resolved/superseded source (e.g. a relationship_tension past Phase 13's resolution window) — a settled signal shouldn't drive a NEW or continuing synthesis. */
  temporalState: string;
  firstObservedAt: Date;
  lastObservedAt: Date;
}

/** Plain-language label for a source type, used only in generated title/description text — never the raw insightType enum value, so the UI never leaks internal taxonomy. */
const SOURCE_TYPE_LABEL: Partial<Record<InsightType, string>> = {
  neglected_goal: 'a goal that has gone quiet',
  recurring_topic: 'a recurring topic',
  priority_tension: 'a priority tension',
  relationship_tension: 'a relationship tension',
};

function normalizeAnchorText(raw: string): string {
  return raw.trim().toLowerCase();
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}

interface AnchoredSource {
  anchorKey: string;
  anchorKind: 'entity' | 'text';
  source: SourceInsightForSynthesis;
}

/**
 * Pure — takes already-eligible-or-not source insights (no DB access),
 * directly unit testable, same shape as every other detector's builder
 * in this file. `entityNames` is the same kind of plain lookup map
 * relationship_tension's builder takes.
 *
 * Eligibility (applied BEFORE anchor-grouping, so a stale/weak/settled
 * source never counts toward MIN_SYNTHESIS_SOURCES or
 * MIN_DISTINCT_SOURCE_TYPES for any anchor):
 *   - temporalState !== 'superseded' (Phase 13's resolved relationship
 *     tensions don't drive a new synthesis)
 *   - confidence >= MIN_SYNTHESIS_SOURCE_CONFIDENCE
 *   - lastObservedAt within MAX_SYNTHESIS_SOURCE_AGE_DAYS of `now`
 *
 * Anchoring:
 *   - subjectEntityId present -> anchor `entity:<id>` (strong).
 *   - priority_tension (no subjectEntityId) -> anchor
 *     `text:<normalized subject>` (weak) AND, if that normalized text
 *     exactly matches the normalized name of an entity anchoring
 *     another eligible source, ALSO `entity:<that id>` — the one
 *     deliberately narrow text-matching bridge this phase allows,
 *     exact-normalized-match only, never fuzzy/partial (documented
 *     limitation: misses paraphrases, same honesty as
 *     personalModel/textSignals.ts's own documented limits).
 *
 * A synthesis requires >= MIN_SYNTHESIS_SOURCES total AND
 * >= MIN_DISTINCT_SOURCE_TYPES distinct insightTypes sharing one
 * anchor — never merely because two insights happen to coexist.
 */
export function buildCrossInsightCandidates(
  input: { sources: SourceInsightForSynthesis[]; entityNames: Map<string, string> },
  now: Date,
): InsightCandidate[] {
  const eligible = input.sources.filter((s) => {
    if (s.temporalState === 'superseded') return false;
    if (s.confidence < MIN_SYNTHESIS_SOURCE_CONFIDENCE) return false;
    const ageDays = (now.getTime() - s.lastObservedAt.getTime()) / MS_PER_DAY;
    return ageDays <= MAX_SYNTHESIS_SOURCE_AGE_DAYS;
  });

  const nameToEntityId = new Map<string, string>();
  for (const [id, nm] of input.entityNames) nameToEntityId.set(normalizeAnchorText(nm), id);

  const anchored: AnchoredSource[] = [];
  for (const s of eligible) {
    if (s.subjectEntityId) {
      anchored.push({ anchorKey: `entity:${s.subjectEntityId}`, anchorKind: 'entity', source: s });
    } else if (s.insightType === 'priority_tension') {
      const normalized = normalizeAnchorText(s.subjectKey);
      anchored.push({ anchorKey: `text:${normalized}`, anchorKind: 'text', source: s });
      const bridgedEntityId = nameToEntityId.get(normalized);
      if (bridgedEntityId) {
        anchored.push({ anchorKey: `entity:${bridgedEntityId}`, anchorKind: 'entity', source: s });
      }
    }
  }

  const groups = new Map<string, AnchoredSource[]>();
  for (const a of anchored) {
    const list = groups.get(a.anchorKey) ?? [];
    list.push(a);
    groups.set(a.anchorKey, list);
  }

  const candidates: InsightCandidate[] = [];
  for (const [anchorKey, members] of groups) {
    // Defensive dedupe: a single source should never appear twice
    // within the SAME anchor group by construction, but never trust
    // that silently — collapse just in case rather than double-count.
    const uniqueBySourceId = new Map<string, AnchoredSource>();
    for (const m of members) uniqueBySourceId.set(m.source.id, m);
    const groupMembers = [...uniqueBySourceId.values()];

    const distinctTypes = new Set(groupMembers.map((m) => m.source.insightType));
    if (groupMembers.length < MIN_SYNTHESIS_SOURCES) continue;
    if (distinctTypes.size < MIN_DISTINCT_SOURCE_TYPES) continue;

    // Deterministic ordering independent of input/iteration order —
    // by insightType then by the source's own (stable) DB id — so the
    // capped subset and the evidence list never depend on how the
    // caller happened to order `input.sources`.
    const sorted = [...groupMembers].sort((a, b) => {
      const byType = a.source.insightType.localeCompare(b.source.insightType);
      return byType !== 0 ? byType : a.source.id.localeCompare(b.source.id);
    });
    const capped = sorted.slice(0, MAX_SYNTHESIS_SOURCES);

    const anchorKind: 'entity' | 'text' = anchorKey.startsWith('entity:') ? 'entity' : 'text';
    const entityId = anchorKind === 'entity' ? anchorKey.slice('entity:'.length) : null;
    const anchorLabel = entityId ? (input.entityNames.get(entityId) ?? 'this') : anchorKey.slice('text:'.length);

    const subjectKey = `${anchorKey}::${[...distinctTypes].sort().join(',')}`;

    const firstObservedAt = capped.reduce(
      (min, m) => (m.source.firstObservedAt.getTime() < min.getTime() ? m.source.firstObservedAt : min),
      capped[0]!.source.firstObservedAt,
    );
    const lastObservedAt = capped.reduce(
      (max, m) => (m.source.lastObservedAt.getTime() > max.getTime() ? m.source.lastObservedAt : max),
      capped[0]!.source.lastObservedAt,
    );

    const confidence = computeCrossInsightConfidence({
      sourceConfidences: capped.map((m) => m.source.confidence),
      anchorStrength: anchorKind,
    });

    const typeLabels = [...distinctTypes].sort().map((t) => SOURCE_TYPE_LABEL[t] ?? t);
    const title = `Multiple signals around "${capitalize(anchorLabel)}"`;
    // Deliberately observational/hedged wording ("Observed signals
    // suggest... Twin's own interpretation, not a confirmed fact") —
    // never "You are..." — a synthesis is the LEAST direct claim in
    // this system: an interpretation about how several already-
    // interpretive insights relate, and it must read that way.
    const description = `Twin noticed ${typeLabels.length} separate patterns connected to "${anchorLabel}": ${typeLabels.join(' and ')}. Observed signals suggest these may be related, though this remains Twin's own interpretation, not a confirmed fact.`;

    const evidence: EvidenceItem[] = capped.map((m) => ({
      evidenceType: 'insight',
      sourceInsightId: m.source.id,
      text: m.source.title,
      observedAt: m.source.lastObservedAt,
    }));

    candidates.push({
      insightType: 'cross_insight',
      subjectKey,
      statusClass: 'inferred',
      temporalState: computeCrossInsightTemporalState(firstObservedAt, now),
      title,
      description,
      confidence,
      subjectEntityId: entityId,
      firstObservedAt,
      lastObservedAt,
      observationCount: capped.length,
      evidence,
    });
  }

  candidates.sort((a, b) => a.subjectKey.localeCompare(b.subjectKey));
  return candidates;
}

/**
 * DB-touching wrapper: ONE batched entity-name lookup, bounded by the
 * (already-bounded, via each detector's own MAX_* scan constants)
 * number of eligible source candidates passed in — never scans the
 * user's full entity table. Delegates to the pure builder above.
 */
export async function computeCrossInsightInsights(
  db: Queryable,
  userId: string,
  sources: SourceInsightForSynthesis[],
  now: Date = new Date(),
): Promise<InsightCandidate[]> {
  const entityIds = [...new Set(sources.map((s) => s.subjectEntityId).filter((id): id is string => Boolean(id)))];
  const entityNames = new Map<string, string>();
  if (entityIds.length > 0) {
    const rows = await db
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .where(and(eq(entities.userId, userId), inArray(entities.id, entityIds)));
    for (const r of rows) entityNames.set(r.id, r.name);
  }
  return buildCrossInsightCandidates({ sources, entityNames }, now);
}
