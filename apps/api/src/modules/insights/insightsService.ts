import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { insights, insightEvidence, memories, personalModelFacts, type Queryable } from '@twin/db';
import type { MemoryWithRelations } from '../memories/memories.service.js';
import type { InsightRow, InsightEvidenceRow } from './insightsStore.js';
import type { PersonalModelFactRow } from '../personalModel/personalModelStore.js';
import { SUPERSEDED_FACT_TEMPORAL_STATES } from './categories.js';

export class InsightError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 404) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * The current insight list a client sees by default: every
 * non-dismissed insight for this user, read directly from `insights`
 * — no rebuild happens here, matching personalModel's
 * getCurrentModel (never rebuild on every page load).
 */
export async function getCurrentInsights(db: Queryable, userId: string): Promise<InsightRow[]> {
  return db
    .select()
    .from(insights)
    .where(and(eq(insights.userId, userId), isNull(insights.dismissedAt)))
    .orderBy(desc(insights.confidence), desc(insights.lastObservedAt));
}

async function getOwnedInsight(db: Queryable, userId: string, insightId: string): Promise<InsightRow> {
  const [row] = await db
    .select()
    .from(insights)
    .where(and(eq(insights.id, insightId), eq(insights.userId, userId)))
    .limit(1);
  if (!row) throw new InsightError(`Insight not found: ${insightId}`, 404);
  return row;
}

export interface InsightEvidenceResult {
  insight: InsightRow;
  evidence: (InsightEvidenceRow & { memory: MemoryWithRelations | null })[];
}

/**
 * The "why did Twin notice this" capability, generated entirely from
 * stored evidence rows — never an LLM-invented explanation. Mirrors
 * personalModel's getFactEvidence exactly.
 */
export async function getInsightEvidence(db: Queryable, userId: string, insightId: string): Promise<InsightEvidenceResult> {
  const insight = await getOwnedInsight(db, userId, insightId);

  const evidenceRows = await db
    .select()
    .from(insightEvidence)
    .where(and(eq(insightEvidence.userId, userId), eq(insightEvidence.insightId, insightId)))
    .orderBy(desc(insightEvidence.observedAt));

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
    insight,
    evidence: evidenceRows.map((e) => ({ ...e, memory: e.memoryId ? (memoryById.get(e.memoryId) ?? null) : null })),
  };
}

/**
 * Phase 16 — pure filter, directly unit testable with hand-built
 * fixtures (same spirit as every pure builder in insightsEngine.ts).
 * A "related" fact is one that shares the insight's subject entity but
 * was NOT already cited as direct evidence: excludes anything already
 * in `directFactIds` (duplicate prevention — a fact that's already the
 * strongest kind of connection shouldn't also appear as a weaker one),
 * and excludes SUPERSEDED_FACT_TEMPORAL_STATES ('outdated'/'superseded')
 * so a fact the user has since corrected away never gets presented as
 * a live connection — it stays fully inspectable via Personal Model's
 * own screen, just not listed here as current support (item 4's "must
 * remain inspectable but must not be presented as current support",
 * applied to the RELATED set; see getInsightPersonalModelContext's own
 * doc comment for why directFacts is handled differently).
 */
export function selectRelatedFacts<T extends { id: string; temporalState: string }>(directFactIds: string[], candidates: T[]): T[] {
  const directSet = new Set(directFactIds);
  return candidates.filter((f) => !directSet.has(f.id) && !SUPERSEDED_FACT_TEMPORAL_STATES.includes(f.temporalState));
}

export interface InsightPersonalModelContextResult {
  insight: InsightRow;
  directFacts: PersonalModelFactRow[];
  relatedFacts: PersonalModelFactRow[];
}

/**
 * Phase 16's "Context" read: how a surfaced insight connects to the
 * user's Personal Model, built entirely from already-stored rows — no
 * new reasoning, no LLM, nothing written back.
 *
 * directFacts: read straight off this insight's OWN evidence trail
 * (evidenceType = 'personal_model_fact') — these are facts Twin
 * explicitly cited when generating the insight (recurring_topic,
 * priority_tension today). Deliberately NOT filtered by the fact's
 * current temporalState or dismissedAt: if a directly-cited fact has
 * since become outdated/superseded/dismissed, hiding it here would
 * silently erase the honest record of "this is what the insight was
 * actually built from" — the frontend is responsible for rendering its
 * current temporalState (e.g. a "no longer current" badge) rather than
 * pretending the citation never happened. This is the inverse tradeoff
 * from relatedFacts (see selectRelatedFacts): a WEAK, merely-structural
 * connection is worth hiding once stale, but a STRONG, already-cited
 * one is worth keeping visible with an honest caveat instead.
 *
 * relatedFacts: a bounded, one-hop lookup for facts sharing the
 * insight's subjectEntityId (skipped entirely when the insight has no
 * subjectEntityId, e.g. a text-anchored cross_insight) — a real column
 * that has existed on personal_model_facts since Phase 9, never a new
 * inference. Two queries beyond getInsightEvidence's own (bounded by
 * inArray/eq on indexed columns), no loop, no N+1.
 */
export async function getInsightPersonalModelContext(
  db: Queryable,
  userId: string,
  insightId: string,
): Promise<InsightPersonalModelContextResult> {
  const { insight, evidence } = await getInsightEvidence(db, userId, insightId);

  const directFactIds = [
    ...new Set(
      evidence
        .filter((e): e is typeof e & { personalModelFactId: string } => e.evidenceType === 'personal_model_fact' && Boolean(e.personalModelFactId))
        .map((e) => e.personalModelFactId),
    ),
  ];

  const directFacts =
    directFactIds.length > 0
      ? await db.select().from(personalModelFacts).where(and(eq(personalModelFacts.userId, userId), inArray(personalModelFacts.id, directFactIds)))
      : [];

  const relatedCandidates = insight.subjectEntityId
    ? await db
        .select()
        .from(personalModelFacts)
        .where(
          and(
            eq(personalModelFacts.userId, userId),
            eq(personalModelFacts.subjectEntityId, insight.subjectEntityId),
            isNull(personalModelFacts.dismissedAt),
          ),
        )
    : [];

  return { insight, directFacts, relatedFacts: selectRelatedFacts(directFactIds, relatedCandidates) };
}

/**
 * SOFT dismiss only — sets dismissedAt so the insight drops out of
 * getCurrentInsights' default view, but the row and its full evidence
 * trail remain in the database, fully inspectable via
 * getInsightEvidence. A dismissed insight is not silently regenerated
 * by the next rebuild unless genuinely new evidence justifies a fresh
 * recurrence (see insightsStore.ts).
 */
export async function dismissInsight(db: Queryable, userId: string, insightId: string, now: Date = new Date()): Promise<InsightRow> {
  const insight = await getOwnedInsight(db, userId, insightId);
  const [updated] = await db
    .update(insights)
    .set({ dismissedAt: now, updatedAt: now })
    .where(eq(insights.id, insight.id))
    .returning();
  if (!updated) throw new Error('insights update returned no row.');
  return updated;
}
