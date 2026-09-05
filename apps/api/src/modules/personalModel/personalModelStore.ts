import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  personalModelFacts,
  personalModelFactEvidence,
  personalModelSnapshots,
  personalModelChanges,
  type Database,
  type Queryable,
} from '@twin/db';
import type { PersonalModelCategory } from '@twin/contracts';
import { computeFactsForUser, type ComputedFact } from './personalModelEngine.js';

export type PersonalModelFactRow = typeof personalModelFacts.$inferSelect;
export type PersonalModelFactEvidenceRow = typeof personalModelFactEvidence.$inferSelect;
export type PersonalModelChangeRow = typeof personalModelChanges.$inferSelect;

const NEW_CHANGE_TYPE_BY_CATEGORY: Record<PersonalModelCategory, string> = {
  important_people: 'new_person',
  active_projects: 'project_started',
  goals: 'new_goal',
  decisions: 'new_decision',
  knowledge_areas: 'interest_strengthened',
  recurring_topics: 'interest_strengthened',
  preferences: 'new_preference',
  constraints: 'new_constraint',
  current_priorities: 'new_priority',
};

/** Confidence-delta thresholds for "strengthened"/"became uncertain" changes — a documented heuristic, not tuned. */
const CONFIDENCE_STRENGTHEN_DELTA = 0.15;
const CONFIDENCE_WEAKEN_DELTA = -0.15;

interface PendingChange {
  factKey: string; // `${category}::${subjectKey}` — resolved to a real factId after upsert
  changeType: string;
  description: string;
  evidenceMemoryIds: string[];
}

/**
 * Item 15's explicit rebuild boundary. Deterministic given the same
 * underlying data: fetch bounded inputs -> compute facts (pure) ->
 * diff against the previous fact rows -> upsert facts (never deleting
 * a superseded/historical one) -> append evidence rows (never
 * overwritten) -> write one new snapshot -> write change-log entries.
 * Everything happens in one transaction — a failure partway through
 * leaves the previous model state intact rather than half-written.
 */
export interface RebuildResult {
  snapshotVersion: number;
  factCount: number;
  changes: PersonalModelChangeRow[];
}

/** Postgres unique_violation — see entities.service.ts for the same pattern applied to entity name races. */
const POSTGRES_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code ?? (err as { cause?: { code?: unknown } })?.cause?.code;
  return code === POSTGRES_UNIQUE_VIOLATION;
}

/** Bounded retries for the rare case of two concurrent rebuilds for the same user racing on the next snapshot version — not expected to ever need more than one retry in practice. */
const MAX_REBUILD_RETRIES = 5;

/**
 * The whole rebuild runs inside one transaction — a failure partway
 * through (facts written but the snapshot insert fails, say) rolls
 * back entirely rather than leaving a half-updated model. Snapshot
 * version numbers are assigned by reading the current max and adding
 * one, which is NOT safe against two truly concurrent rebuilds for the
 * same user (e.g. two browser tabs open to the Personal Model screen
 * at once) — Postgres's default isolation lets both transactions read
 * the same max before either commits. Rather than serialize every
 * rebuild behind a lock, the whole attempt is retried from scratch on
 * the resulting unique-constraint conflict: computeFactsForUser is
 * deterministic and the upserts are idempotent, so re-running the
 * entire transaction is safe, just occasionally redundant.
 */
export async function rebuildPersonalModel(db: Database, userId: string, now: Date = new Date()): Promise<RebuildResult> {
  for (let attempt = 1; attempt <= MAX_REBUILD_RETRIES; attempt++) {
    try {
      return await db.transaction((tx) => rebuildPersonalModelTx(tx, userId, now));
    } catch (err) {
      if (isUniqueViolation(err) && attempt < MAX_REBUILD_RETRIES) continue;
      throw err;
    }
  }
  throw new Error('rebuildPersonalModel: exhausted retries.');
}

async function rebuildPersonalModelTx(db: Queryable, userId: string, now: Date): Promise<RebuildResult> {
  const computedFacts = await computeFactsForUser(db, userId, now);

  const previousRows = await db
    .select()
    .from(personalModelFacts)
    .where(and(eq(personalModelFacts.userId, userId), isNull(personalModelFacts.dismissedAt)));
  const previousByKey = new Map(previousRows.map((r) => [`${r.category}::${r.subjectKey}`, r]));

  // Phase 9.1: computeFactsForUser only ever looks at
  // entities/relationships/memories — it has no idea a fact was
  // manually corrected, so without this a rebuild would silently
  // overwrite a user's correction with freshly recomputed values the
  // next time new memories came in. A fact is "pinned" against that
  // overwrite when its most recent evidence is a still-live (not
  // itself later superseded) user_correction — i.e. the user's own
  // words are the newest thing said about it. Pinned facts still gain
  // new automated evidence rows (harmless, additive), just not a
  // rollup overwrite.
  const pinnedRows = await db
    .selectDistinct({ factId: personalModelFactEvidence.factId })
    .from(personalModelFactEvidence)
    .where(
      and(
        eq(personalModelFactEvidence.userId, userId),
        eq(personalModelFactEvidence.evidenceSource, 'user_correction'),
        isNull(personalModelFactEvidence.supersededAt),
      ),
    );
  const pinnedFactIds = new Set(pinnedRows.map((r) => r.factId));

  const pendingChanges: PendingChange[] = [];
  const factRowByKey = new Map<string, PersonalModelFactRow>();

  for (const fact of computedFacts) {
    const key = `${fact.category}::${fact.subjectKey}`;
    const prev = previousByKey.get(key);
    const isPinned = Boolean(prev && pinnedFactIds.has(prev.id));
    const memoryIds = [...new Set(fact.observations.map((o) => o.memoryId).filter((id): id is string => Boolean(id)))];

    if (!prev) {
      pendingChanges.push({
        factKey: key,
        changeType: NEW_CHANGE_TYPE_BY_CATEGORY[fact.category],
        description: `New ${categoryLabel(fact.category)}: ${fact.factText}`,
        evidenceMemoryIds: memoryIds,
      });
    } else if (!isPinned) {
      if (prev.temporalState === 'current' && fact.temporalState !== 'current') {
        pendingChanges.push({
          factKey: key,
          changeType: fact.category === 'active_projects' ? 'project_became_inactive' : 'fact_became_historical',
          description: `${fact.factText} — no longer recently active.`,
          evidenceMemoryIds: memoryIds,
        });
      }
      const delta = fact.confidence - Number(prev.confidence);
      if (delta <= CONFIDENCE_WEAKEN_DELTA) {
        pendingChanges.push({
          factKey: key,
          changeType: 'belief_became_uncertain',
          description: `${fact.factText} — confidence decreased.`,
          evidenceMemoryIds: memoryIds,
        });
      } else if (delta >= CONFIDENCE_STRENGTHEN_DELTA) {
        pendingChanges.push({
          factKey: key,
          changeType: 'interest_strengthened',
          description: `${fact.factText} — confidence increased.`,
          evidenceMemoryIds: memoryIds,
        });
      }
    }

    const [row] = await db
      .insert(personalModelFacts)
      .values({
        userId,
        category: fact.category,
        subjectKey: fact.subjectKey,
        subjectEntityId: fact.subjectEntityId,
        factText: fact.factText,
        epistemicStatus: fact.epistemicStatus,
        confidence: fact.confidence.toFixed(2),
        stability: fact.stability,
        temporalState: fact.temporalState,
        firstObservedAt: prev ? prev.firstObservedAt : fact.firstObservedAt,
        lastObservedAt: fact.lastObservedAt,
        observationCount: fact.observationCount,
        dismissedAt: null,
      })
      .onConflictDoUpdate({
        target: [personalModelFacts.userId, personalModelFacts.category, personalModelFacts.subjectKey],
        set: isPinned
          ? { updatedAt: now }
          : {
              factText: fact.factText,
              epistemicStatus: fact.epistemicStatus,
              confidence: fact.confidence.toFixed(2),
              stability: fact.stability,
              temporalState: fact.temporalState,
              lastObservedAt: fact.lastObservedAt,
              observationCount: fact.observationCount,
              updatedAt: now,
            },
      })
      .returning();
    if (!row) throw new Error('personal_model_facts upsert returned no row.');
    factRowByKey.set(key, row);

    await writeFactEvidence(db, userId, row.id, fact);
  }

  const latestSnapshotRows = await db
    .select({ version: personalModelSnapshots.version })
    .from(personalModelSnapshots)
    .where(eq(personalModelSnapshots.userId, userId))
    .orderBy(desc(personalModelSnapshots.version))
    .limit(1);
  const nextVersion = (latestSnapshotRows[0]?.version ?? 0) + 1;
  const factsJson = computedFacts.map((f) => ({
    category: f.category,
    subjectKey: f.subjectKey,
    factText: f.factText,
    epistemicStatus: f.epistemicStatus,
    confidence: f.confidence,
    stability: f.stability,
    temporalState: f.temporalState,
  }));

  const [snapshot] = await db
    .insert(personalModelSnapshots)
    .values({ userId, version: nextVersion, factsJson, factCount: computedFacts.length })
    .returning();
  if (!snapshot) throw new Error('personal_model_snapshots insert returned no row.');

  const changeRows: PersonalModelChangeRow[] = [];
  for (const change of pendingChanges) {
    const factRow = factRowByKey.get(change.factKey);
    const [inserted] = await db
      .insert(personalModelChanges)
      .values({
        userId,
        factId: factRow?.id ?? null,
        snapshotId: snapshot.id,
        changeType: change.changeType,
        description: change.description,
        evidenceMemoryIds: change.evidenceMemoryIds,
      })
      .returning();
    if (inserted) changeRows.push(inserted);
  }

  return { snapshotVersion: nextVersion, factCount: computedFacts.length, changes: changeRows };
}

async function writeFactEvidence(db: Queryable, userId: string, factId: string, fact: ComputedFact): Promise<void> {
  // One evidence row per distinct memory/relationship, deduped the
  // same way observationCount is — never a duplicate row for the same
  // underlying evidence across repeated rebuilds (idempotent).
  const seen = new Set<string>();
  for (const obs of fact.observations) {
    const dedupeKey = obs.memoryId ?? obs.relationshipId ?? `${obs.evidenceSource}:${obs.observedAt.getTime()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    await db
      .insert(personalModelFactEvidence)
      .values({
        userId,
        factId,
        evidenceSource: obs.evidenceSource,
        memoryId: obs.memoryId,
        relationshipId: obs.relationshipId,
        entityId: obs.entityId,
        epistemicStatus: obs.epistemicStatus,
        confidence: obs.confidence.toFixed(2),
        evidenceText: obs.evidenceText,
        observedAt: obs.observedAt,
      })
      .onConflictDoNothing();
  }
}

function categoryLabel(category: PersonalModelCategory): string {
  return category.replace(/_/g, ' ');
}
