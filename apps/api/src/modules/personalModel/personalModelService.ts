import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { personalModelFacts, personalModelFactEvidence, personalModelChanges, memories, type Queryable } from '@twin/db';
import type { MemoryWithRelations } from '../memories/memories.service.js';
import { UNCERTAIN_CONFIDENCE_THRESHOLD } from './categories.js';
import { aggregateConfidence } from './confidence.js';
import { hasNegationCue, hasReplacementCue, hasHedgeCue } from './textSignals.js';
import type { PersonalModelFactRow, PersonalModelFactEvidenceRow, PersonalModelChangeRow } from './personalModelStore.js';

export class PersonalModelError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 404) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * The "current model" a client sees by default: every non-dismissed
 * fact for this user, read directly from personal_model_facts — no
 * rebuild happens here (item 24: never rebuild on every page load).
 * Callers that want fresh data call the explicit rebuild endpoint
 * first (or the frontend does, once, on opening the Personal Model
 * screen — see apps/web/src/services/personalModelApi.ts).
 */
export async function getCurrentModel(db: Queryable, userId: string): Promise<PersonalModelFactRow[]> {
  return db
    .select()
    .from(personalModelFacts)
    .where(and(eq(personalModelFacts.userId, userId), isNull(personalModelFacts.dismissedAt)))
    .orderBy(desc(personalModelFacts.confidence), desc(personalModelFacts.lastObservedAt));
}

export function uncertainFactIds(facts: PersonalModelFactRow[]): string[] {
  return facts.filter((f) => Number(f.confidence) < UNCERTAIN_CONFIDENCE_THRESHOLD).map((f) => f.id);
}

async function getOwnedFact(db: Queryable, userId: string, factId: string): Promise<PersonalModelFactRow> {
  const [fact] = await db
    .select()
    .from(personalModelFacts)
    .where(and(eq(personalModelFacts.id, factId), eq(personalModelFacts.userId, userId)))
    .limit(1);
  if (!fact) throw new PersonalModelError(`Personal Model fact not found: ${factId}`, 404);
  return fact;
}

export interface FactEvidenceResult {
  fact: PersonalModelFactRow;
  evidence: (PersonalModelFactEvidenceRow & { memory: MemoryWithRelations | null })[];
}

/**
 * Item 13's "why does Twin think this" capability, generated entirely
 * from stored evidence rows — never an LLM-invented explanation.
 */
export async function getFactEvidence(db: Queryable, userId: string, factId: string): Promise<FactEvidenceResult> {
  const fact = await getOwnedFact(db, userId, factId);

  const evidenceRows = await db
    .select()
    .from(personalModelFactEvidence)
    .where(and(eq(personalModelFactEvidence.userId, userId), eq(personalModelFactEvidence.factId, factId)))
    .orderBy(desc(personalModelFactEvidence.observedAt));

  const memoryIds = [...new Set(evidenceRows.map((e) => e.memoryId).filter((id): id is string => Boolean(id)))];
  const memoryRows =
    memoryIds.length > 0
      ? ((await db.query.memories.findMany({
          where: and(eq(memories.userId, userId), inArray(memories.id, memoryIds)),
          with: { source: true, entityLinks: { with: { entity: true } } },
        })) as MemoryWithRelations[])
      : [];
  const memoryById = new Map(memoryRows.map((m) => [m.id, m]));

  return {
    fact,
    evidence: evidenceRows.map((e) => ({ ...e, memory: e.memoryId ? (memoryById.get(e.memoryId) ?? null) : null })),
  };
}

export async function listChanges(db: Queryable, userId: string, limit = 50): Promise<PersonalModelChangeRow[]> {
  return db
    .select()
    .from(personalModelChanges)
    .where(eq(personalModelChanges.userId, userId))
    .orderBy(desc(personalModelChanges.createdAt))
    .limit(limit);
}

/**
 * Recomputes a fact's rollup confidence from its LIVE evidence — the
 * same "strongest tier + repetition bonus" rule the rebuild engine
 * uses, so a manual confirm/correct action and a rebuild never
 * disagree about how confidence is derived. Phase 9.1: evidence a
 * later correction has marked `supersededAt` is excluded from this
 * aggregation (though never deleted — see getFactEvidence), which is
 * what lets a contradicting or weakening correction actually move
 * confidence down instead of the old "strongest tier ever recorded
 * wins forever" behavior silently re-strengthening a fact the user
 * just said was wrong.
 */
async function refreshFactRollup(db: Queryable, factId: string): Promise<void> {
  const evidenceRows = await db
    .select({ epistemicStatus: personalModelFactEvidence.epistemicStatus, confidence: personalModelFactEvidence.confidence })
    .from(personalModelFactEvidence)
    .where(and(eq(personalModelFactEvidence.factId, factId), isNull(personalModelFactEvidence.supersededAt)));

  const confidence = aggregateConfidence(evidenceRows.map((e) => ({ epistemicStatus: e.epistemicStatus, confidence: Number(e.confidence) })));
  await db
    .update(personalModelFacts)
    .set({ confidence: confidence.toFixed(2), updatedAt: new Date() })
    .where(eq(personalModelFacts.id, factId));
}

/**
 * Item 21's confirm control — the user telling Twin "yes, this is
 * right" is itself explicit evidence (item 3's strongest tier), so it
 * both records a new evidence row AND can raise the fact's rollup
 * epistemicStatus to 'explicit' if it wasn't already (never the
 * reverse — confirming never downgrades a fact).
 */
export async function confirmFact(db: Queryable, userId: string, factId: string, now: Date = new Date()): Promise<PersonalModelFactRow> {
  const fact = await getOwnedFact(db, userId, factId);

  await db.insert(personalModelFactEvidence).values({
    userId,
    factId,
    evidenceSource: 'user_confirmation',
    memoryId: null,
    relationshipId: null,
    entityId: null,
    epistemicStatus: 'explicit',
    confidence: '1.00',
    evidenceText: 'Confirmed by user.',
    observedAt: now,
  });

  await refreshFactRollup(db, factId);
  const [updated] = await db
    .update(personalModelFacts)
    .set({ epistemicStatus: 'explicit', dismissedAt: null, lastObservedAt: now, updatedAt: now })
    .where(eq(personalModelFacts.id, fact.id))
    .returning();
  if (!updated) throw new Error('personal_model_facts update returned no row.');
  return updated;
}

/** Confidence assigned to a hedged correction's own evidence row — the same cap the automated extractor uses for hedged observations (see personalModelEngine.ts), so a manual "I might not..." correction reads the same way as an automatically-detected hedge. */
const HEDGED_CORRECTION_CONFIDENCE = '0.40';

/**
 * Phase 9.1's correction semantics. A prior correction could only ever
 * strengthen a fact — `refreshFactRollup` aggregated across every
 * evidence row ever recorded, so a contradicting correction ("I don't
 * like dark mode anymore") just got averaged in with the original
 * evidence as if they still agreed, and the fact could never actually
 * change state. This classifies each correction deterministically from
 * its own text (no LLM, no client-supplied label — see the cue lists
 * in textSignals.ts) into one of three shapes:
 *
 *  - plain refinement (no cue): unchanged from before — the correction
 *    reinforces/refines the SAME claim, prior evidence stays live, and
 *    confidence aggregates across all of it as usual.
 *  - weakened (hedge cue, e.g. "I might not really..."): prior
 *    evidence is marked superseded (still fully readable via
 *    getFactEvidence, just excluded from the live rollup) so
 *    confidence reflects the new hedged uncertainty instead of staying
 *    pinned at the old value.
 *  - contradicted (negation cue): prior evidence is marked superseded
 *    the same way. If the correction also states a replacement
 *    ("I've switched to mornings"), the fact stays temporalState =
 *    'current' with the new claim (superseded, not lost — item 6's
 *    "original evidence remains available"). If it's a bare retraction
 *    with nothing to replace it ("I don't really prefer dark mode
 *    anymore"), the fact is marked temporalState = 'outdated' instead
 *    of silently staying 'current' as if nothing happened.
 *
 * In every case no evidence row is ever deleted or rewritten, only
 * flagged supersededAt — so "why did Twin think this" and "why did it
 * change" are both answerable from the same evidence list, and the
 * original claim's provenance never disappears just because the
 * model's current best guess moved on.
 */
export async function correctFact(
  db: Queryable,
  userId: string,
  factId: string,
  correctedText: string,
  now: Date = new Date(),
): Promise<PersonalModelFactRow> {
  const fact = await getOwnedFact(db, userId, factId);

  const isContradiction = hasNegationCue(correctedText);
  const isReplacement = isContradiction && hasReplacementCue(correctedText);
  const isHedged = hasHedgeCue(correctedText);
  const supersedesPriorEvidence = isContradiction || isHedged;

  if (supersedesPriorEvidence) {
    await db
      .update(personalModelFactEvidence)
      .set({ supersededAt: now })
      .where(and(eq(personalModelFactEvidence.factId, factId), isNull(personalModelFactEvidence.supersededAt)));
  }

  await db.insert(personalModelFactEvidence).values({
    userId,
    factId,
    evidenceSource: 'user_correction',
    memoryId: null,
    relationshipId: null,
    entityId: null,
    epistemicStatus: 'explicit',
    confidence: isHedged ? HEDGED_CORRECTION_CONFIDENCE : '1.00',
    evidenceText: correctedText,
    observedAt: now,
  });

  let changeType: string;
  let description: string;
  let temporalState: string | undefined;
  let stability: string | undefined;

  if (isContradiction && isReplacement) {
    changeType = 'fact_superseded';
    description = `Superseded by user correction: "${fact.factText}" -> "${correctedText}"`;
    temporalState = 'current';
    stability = 'changing';
  } else if (isContradiction) {
    changeType = 'fact_contradicted';
    description = `Contradicted by user correction: "${fact.factText}" -> "${correctedText}"`;
    temporalState = 'outdated';
    stability = 'changing';
  } else if (isHedged) {
    changeType = 'fact_weakened';
    description = `Weakened by hedged user correction: "${fact.factText}" -> "${correctedText}"`;
    stability = 'changing';
  } else {
    changeType = 'fact_corrected';
    description = `Corrected by user: "${fact.factText}" -> "${correctedText}"`;
  }

  await db.insert(personalModelChanges).values({
    userId,
    factId: fact.id,
    snapshotId: null,
    changeType,
    description,
    evidenceMemoryIds: [],
  });

  await refreshFactRollup(db, factId);
  const [updated] = await db
    .update(personalModelFacts)
    .set({
      factText: correctedText,
      epistemicStatus: 'explicit',
      ...(temporalState ? { temporalState } : {}),
      ...(stability ? { stability } : {}),
      dismissedAt: null,
      lastObservedAt: now,
      updatedAt: now,
    })
    .where(eq(personalModelFacts.id, fact.id))
    .returning();
  if (!updated) throw new Error('personal_model_facts update returned no row.');
  return updated;
}

/**
 * Item 21's dismiss control — SOFT only. Sets dismissedAt so the fact
 * drops out of getCurrentModel's default view, but the fact row and
 * its entire evidence trail remain in the database, fully inspectable
 * via getFactEvidence — "dismiss" can never destroy history.
 */
export async function dismissFact(db: Queryable, userId: string, factId: string, now: Date = new Date()): Promise<PersonalModelFactRow> {
  const fact = await getOwnedFact(db, userId, factId);

  await db.insert(personalModelFactEvidence).values({
    userId,
    factId,
    evidenceSource: 'user_dismissal',
    memoryId: null,
    relationshipId: null,
    entityId: null,
    epistemicStatus: fact.epistemicStatus,
    confidence: fact.confidence,
    evidenceText: 'Dismissed by user.',
    observedAt: now,
  });

  await db.insert(personalModelChanges).values({
    userId,
    factId: fact.id,
    snapshotId: null,
    changeType: 'fact_dismissed',
    description: `Dismissed by user: ${fact.factText}`,
    evidenceMemoryIds: [],
  });

  const [updated] = await db
    .update(personalModelFacts)
    .set({ dismissedAt: now, updatedAt: now })
    .where(eq(personalModelFacts.id, fact.id))
    .returning();
  if (!updated) throw new Error('personal_model_facts update returned no row.');
  return updated;
}
