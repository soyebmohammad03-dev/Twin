import { and, eq, inArray, ne } from 'drizzle-orm';
import { insights, insightEvidence, type Database, type Queryable } from '@twin/db';
import {
  computeAllInsightCandidates,
  computeCrossInsightInsights,
  type EvidenceItem,
  type InsightCandidate,
  type SourceInsightForSynthesis,
} from './insightsEngine.js';
import { rebuildPersonalModel } from '../personalModel/personalModelStore.js';

/** Postgres unique_violation — see personalModelStore.ts for the same pattern applied to the snapshot-version race. */
const POSTGRES_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code ?? (err as { cause?: { code?: unknown } })?.cause?.code;
  return code === POSTGRES_UNIQUE_VIOLATION;
}

export type InsightRow = typeof insights.$inferSelect;
export type InsightEvidenceRow = typeof insightEvidence.$inferSelect;

export interface RebuildInsightsResult {
  insightCount: number;
}

/** Bounded retries for two truly concurrent rebuilds for the same user racing on the evidence partial unique indexes (migrations 0012/0013/0014) — e.g. a React StrictMode double effect-fire. Same pattern and bound as personalModelStore.ts's MAX_REBUILD_RETRIES. */
const MAX_REBUILD_RETRIES = 5;

/**
 * The rebuild boundary — deterministic given the same underlying
 * data, same explicit-trigger-only rule as personalModel's rebuild
 * (never rebuild on every page load). Phase 11 adds an explicit
 * one-way dependency: Personal Model is rebuilt FIRST, because
 * `recurring_topic`/`priority_tension` are derived entirely from its
 * current facts (see insightsEngine.ts's computeAllInsightCandidates)
 * and nothing guarantees the sibling PersonalModelSection component's
 * own rebuild-on-mount has already run before InsightsSection's does.
 * personalModel's rebuild keeps its own independent transaction —
 * this is a sequential await, not a nested transaction.
 *
 * The per-insight rollup upsert is race-safe on its own via
 * onConflictDoUpdate against the (userId, insightType, subjectKey)
 * unique constraint, but the insight_evidence 'entity' and
 * 'personal_model_fact' rows' own uniqueness (migrations 0012/0013/0014)
 * is enforced with an explicit check-then-insert rather than
 * onConflictDoNothing, which leaves a narrow window under two truly
 * concurrent rebuilds. Any resulting unique_violation aborts the
 * whole transaction (Postgres's behavior, not a choice made here), so
 * the recovery is retrying the entire transaction from scratch — safe
 * because computeAllInsightCandidates and the upsert logic are both
 * deterministic and idempotent.
 */
export async function rebuildInsights(db: Database, userId: string, now: Date = new Date()): Promise<RebuildInsightsResult> {
  await rebuildPersonalModel(db, userId, now);

  for (let attempt = 1; attempt <= MAX_REBUILD_RETRIES; attempt++) {
    try {
      return await db.transaction((tx) => rebuildInsightsTx(tx, userId, now));
    } catch (err) {
      if (isUniqueViolation(err) && attempt < MAX_REBUILD_RETRIES) continue;
      throw err;
    }
  }
  throw new Error('rebuildInsights: exhausted retries.');
}

/**
 * Phase 14: rebuilds in two passes within the same transaction.
 *
 *   Pass 1 upserts every FIRST-ORDER candidate (neglected_goal,
 *   recurring_topic, priority_tension, relationship_tension) exactly
 *   as Phases 10-13 always have — unchanged behavior, unchanged tests.
 *
 *   Pass 2 computes cross_insight synthesis FROM those same first-
 *   order candidates, but only after pass 1 has committed real DB ids
 *   for them (a synthesis's evidence must point at a REAL insight row
 *   — see insightsEngine.ts's SourceInsightForSynthesis) and only for
 *   the ones that are actually live afterward (present in the table,
 *   not dismissed) — a dismissed first-order insight does not get to
 *   keep feeding a synthesis just because its own candidate is still
 *   computed.
 *
 * Both passes reuse the identical upsert-one-batch logic (see
 * upsertCandidateBatch) and the identical resolve/dismissal-
 * suppression rules — cross_insight is a new TYPE, not a new
 * lifecycle, and non-cross_insight resolution is scoped with
 * `ne(insights.insightType, 'cross_insight')` so pass 1 can never
 * accidentally delete a cross_insight row before pass 2 even runs.
 */
async function rebuildInsightsTx(db: Queryable, userId: string, now: Date): Promise<RebuildInsightsResult> {
  const previousRows = await db.select().from(insights).where(eq(insights.userId, userId));
  const previousByKey = new Map(previousRows.map((r) => [`${r.insightType}::${r.subjectKey}`, r]));

  // --- Pass 1: first-order insights (unchanged from Phases 10-13) ---
  const baseCandidates = await computeAllInsightCandidates(db, userId, now);
  const baseCandidateKeys = new Set(baseCandidates.map((c) => `${c.insightType}::${c.subjectKey}`));

  const toResolveBase = previousRows.filter(
    (r) => r.insightType !== 'cross_insight' && !r.dismissedAt && !baseCandidateKeys.has(`${r.insightType}::${r.subjectKey}`),
  );
  if (toResolveBase.length > 0) {
    await db.delete(insights).where(
      inArray(
        insights.id,
        toResolveBase.map((r) => r.id),
      ),
    );
  }

  const baseCount = await upsertCandidateBatch(db, userId, now, baseCandidates, previousByKey);

  // --- Pass 2: cross-insight synthesis, sourced from pass 1's committed rows ---
  const currentBaseRows = await db
    .select()
    .from(insights)
    .where(and(eq(insights.userId, userId), ne(insights.insightType, 'cross_insight')));
  // Only LIVE (non-dismissed) rows may feed a synthesis — a user
  // dismissing a first-order insight is a signal that it shouldn't
  // keep influencing higher-order patterns either.
  const liveBaseByKey = new Map(currentBaseRows.filter((r) => !r.dismissedAt).map((r) => [`${r.insightType}::${r.subjectKey}`, r]));

  const sources: SourceInsightForSynthesis[] = [];
  for (const c of baseCandidates) {
    const row = liveBaseByKey.get(`${c.insightType}::${c.subjectKey}`);
    if (!row) continue; // dismissed, or otherwise didn't end up persisted this rebuild
    sources.push({
      id: row.id,
      insightType: c.insightType,
      subjectKey: c.subjectKey,
      subjectEntityId: c.subjectEntityId,
      title: c.title,
      confidence: c.confidence,
      temporalState: row.temporalState,
      firstObservedAt: row.firstObservedAt,
      lastObservedAt: row.lastObservedAt,
    });
  }

  const crossCandidates = await computeCrossInsightInsights(db, userId, sources, now);
  const crossCandidateKeys = new Set(crossCandidates.map((c) => `${c.insightType}::${c.subjectKey}`));

  const previousCrossRows = previousRows.filter((r) => r.insightType === 'cross_insight');
  const toResolveCross = previousCrossRows.filter((r) => !r.dismissedAt && !crossCandidateKeys.has(`${r.insightType}::${r.subjectKey}`));
  if (toResolveCross.length > 0) {
    await db.delete(insights).where(
      inArray(
        insights.id,
        toResolveCross.map((r) => r.id),
      ),
    );
  }

  const previousCrossByKey = new Map(previousCrossRows.map((r) => [`${r.insightType}::${r.subjectKey}`, r]));
  const crossCount = await upsertCandidateBatch(db, userId, now, crossCandidates, previousCrossByKey);

  return { insightCount: baseCount + crossCount };
}

/**
 * The per-candidate upsert loop shared by both rebuild passes —
 * identical dismissal-suppression and onConflictDoUpdate logic Phases
 * 10-13 already established, extracted so cross_insight reuses it
 * verbatim rather than duplicating it.
 */
async function upsertCandidateBatch(
  db: Queryable,
  userId: string,
  now: Date,
  candidates: InsightCandidate[],
  previousByKey: Map<string, InsightRow>,
): Promise<number> {
  let count = 0;
  for (const candidate of candidates) {
    const key = `${candidate.insightType}::${candidate.subjectKey}`;
    const prev = previousByKey.get(key);

    // Dismissal suppression: a dismissed insight must not silently
    // reappear just because the same underlying pattern is still
    // computed as a candidate. It's only allowed to resurface when
    // genuinely NEW evidence (observed after the dismissal) is behind
    // it — a fresh recurrence, not a resurrected stale one.
    const isDismissed = Boolean(prev?.dismissedAt);
    const hasNewEvidenceSinceDismissal = isDismissed && candidate.lastObservedAt.getTime() > prev!.dismissedAt!.getTime();
    if (isDismissed && !hasNewEvidenceSinceDismissal) continue;

    const [row] = await db
      .insert(insights)
      .values({
        userId,
        insightType: candidate.insightType,
        subjectKey: candidate.subjectKey,
        statusClass: candidate.statusClass,
        temporalState: candidate.temporalState,
        title: candidate.title,
        description: candidate.description,
        confidence: candidate.confidence.toFixed(2),
        subjectEntityId: candidate.subjectEntityId,
        firstObservedAt: prev ? prev.firstObservedAt : candidate.firstObservedAt,
        lastObservedAt: candidate.lastObservedAt,
        observationCount: candidate.observationCount,
        dismissedAt: null,
      })
      .onConflictDoUpdate({
        target: [insights.userId, insights.insightType, insights.subjectKey],
        set: {
          statusClass: candidate.statusClass,
          temporalState: candidate.temporalState,
          title: candidate.title,
          description: candidate.description,
          confidence: candidate.confidence.toFixed(2),
          subjectEntityId: candidate.subjectEntityId,
          lastObservedAt: candidate.lastObservedAt,
          observationCount: candidate.observationCount,
          updatedAt: now,
          ...(hasNewEvidenceSinceDismissal ? { dismissedAt: null } : {}),
        },
      })
      .returning();
    if (!row) throw new Error('insights upsert returned no row.');
    count += 1;

    await writeInsightEvidence(db, userId, row.id, candidate.evidence);
  }
  return count;
}

/**
 * Generic over every evidence shape a detector can produce (Phase 10's
 * 'entity'/'memory' rows, Phase 11's 'personal_model_fact' rows,
 * Phase 12's 'relationship' rows). 'memory' rows dedupe correctly via
 * the existing (insightId, memoryId) unique constraint (memoryId is
 * always non-null there), but 'entity'/'personal_model_fact'/
 * 'relationship' rows always have memoryId = null — Postgres treats
 * NULL as distinct, so that constraint doesn't cover them. Each gets
 * an explicit existence check plus a real backstop partial unique
 * index (migration 0012 for 'entity', keyed on just insightId since a
 * neglected_goal insight has exactly one; 0013 for
 * 'personal_model_fact' and 0014 for 'relationship', both keyed on
 * (insightId, <the fact/relationship id>) since a tension insight
 * legitimately has TWO or more such rows, not one).
 *
 * Phase 13: the 'relationship' and 'memory' branches now also UPDATE
 * an already-existing row's `supersededAt` — the one field a
 * relationship_tension's evidence is allowed to have change across
 * rebuilds (which side is "current" vs "superseded" can flip as new
 * evidence arrives), never evidenceText/observedAt/memoryId/
 * relationshipId, which describe the original, immutable observation
 * itself. Every other insight type's items never set `supersededAt`
 * (stays undefined), so this update is a harmless no-op for them.
 */
async function writeInsightEvidence(db: Queryable, userId: string, insightId: string, evidence: EvidenceItem[]): Promise<void> {
  for (const item of evidence) {
    if (item.evidenceType === 'entity') {
      const [existing] = await db
        .select({ id: insightEvidence.id })
        .from(insightEvidence)
        .where(and(eq(insightEvidence.insightId, insightId), eq(insightEvidence.evidenceType, 'entity')))
        .limit(1);
      if (!existing) {
        // NOT caught here: a unique_violation on this insert would
        // poison the enclosing transaction (Postgres aborts the whole
        // transaction on any statement error, not just this one), so
        // the only valid recovery is retrying the ENTIRE rebuild
        // transaction from scratch — see rebuildInsights' retry loop.
        await db.insert(insightEvidence).values({
          userId,
          insightId,
          evidenceType: 'entity',
          entityId: item.entityId,
          evidenceText: item.text,
          observedAt: item.observedAt,
        });
      }
    } else if (item.evidenceType === 'personal_model_fact') {
      const [existing] = await db
        .select({ id: insightEvidence.id })
        .from(insightEvidence)
        .where(
          and(
            eq(insightEvidence.insightId, insightId),
            eq(insightEvidence.evidenceType, 'personal_model_fact'),
            eq(insightEvidence.personalModelFactId, item.personalModelFactId),
          ),
        )
        .limit(1);
      if (!existing) {
        await db.insert(insightEvidence).values({
          userId,
          insightId,
          evidenceType: 'personal_model_fact',
          personalModelFactId: item.personalModelFactId,
          evidenceText: item.text,
          observedAt: item.observedAt,
        });
      }
    } else if (item.evidenceType === 'relationship') {
      const [existing] = await db
        .select({ id: insightEvidence.id, supersededAt: insightEvidence.supersededAt })
        .from(insightEvidence)
        .where(
          and(
            eq(insightEvidence.insightId, insightId),
            eq(insightEvidence.evidenceType, 'relationship'),
            eq(insightEvidence.relationshipId, item.relationshipId),
          ),
        )
        .limit(1);
      if (!existing) {
        await db.insert(insightEvidence).values({
          userId,
          insightId,
          evidenceType: 'relationship',
          relationshipId: item.relationshipId,
          evidenceText: item.text,
          observedAt: item.observedAt,
          supersededAt: item.supersededAt ?? null,
        });
      } else {
        // Phase 13: a relationship's side within a tension can flip
        // between current and superseded across rebuilds (new evidence
        // can make a formerly-prior side current again) — supersededAt
        // is the one field this evidence row's own content is allowed
        // to change on an existing row, never evidenceText/observedAt
        // (which describe the original, unaltered observation).
        await db
          .update(insightEvidence)
          .set({ supersededAt: item.supersededAt ?? null })
          .where(eq(insightEvidence.id, existing.id));
      }
    } else if (item.evidenceType === 'insight') {
      // Phase 14: a cross_insight's evidence — one row per contributing
      // first-order source, pointing at its REAL insight id (resolved
      // before this call, see rebuildInsightsTx's pass 2). No
      // supersededAt tracking here: a source either currently
      // contributes to this synthesis (present) or it doesn't (simply
      // absent from the next rebuild's evidence set) — there is no
      // "current vs superseded side" distinction within one synthesis
      // the way relationship_tension's two sides have.
      const [existing] = await db
        .select({ id: insightEvidence.id })
        .from(insightEvidence)
        .where(
          and(
            eq(insightEvidence.insightId, insightId),
            eq(insightEvidence.evidenceType, 'insight'),
            eq(insightEvidence.sourceInsightId, item.sourceInsightId),
          ),
        )
        .limit(1);
      if (!existing) {
        await db.insert(insightEvidence).values({
          userId,
          insightId,
          evidenceType: 'insight',
          sourceInsightId: item.sourceInsightId,
          evidenceText: item.text,
          observedAt: item.observedAt,
        });
      }
    } else {
      const [existing] = await db
        .select({ id: insightEvidence.id })
        .from(insightEvidence)
        .where(and(eq(insightEvidence.insightId, insightId), eq(insightEvidence.evidenceType, 'memory'), eq(insightEvidence.memoryId, item.memoryId)))
        .limit(1);
      if (!existing) {
        await db.insert(insightEvidence).values({
          userId,
          insightId,
          evidenceType: 'memory',
          memoryId: item.memoryId,
          evidenceText: item.text,
          observedAt: item.observedAt,
          supersededAt: item.supersededAt ?? null,
        });
      } else if (item.supersededAt !== undefined) {
        // Only relationship_tension's per-side memory quotes ever set
        // supersededAt; every other insight type's memory evidence
        // leaves it undefined and this branch is a no-op for them.
        await db
          .update(insightEvidence)
          .set({ supersededAt: item.supersededAt ?? null })
          .where(eq(insightEvidence.id, existing.id));
      }
    }
  }
}
