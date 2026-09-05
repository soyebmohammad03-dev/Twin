import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { entityRelationships, relationshipEvidence, type Queryable } from '@twin/db';
import type { EpistemicStatus } from '@twin/contracts';

export type EntityRelationshipRow = typeof entityRelationships.$inferSelect;
export type RelationshipEvidenceRow = typeof relationshipEvidence.$inferSelect;

/**
 * Relative trust ordering for epistemic statuses, used only to decide
 * whether a *new* piece of evidence should upgrade a relationship's
 * rollup fields (see upsertRelationshipWithEvidence below) — not used
 * anywhere memories themselves are scored. Higher = more directly
 * stated by the user. This is a documented editorial ranking, not a
 * scientifically derived one.
 */
export const EPISTEMIC_STRENGTH: Record<EpistemicStatus, number> = {
  explicit: 4,
  from_source: 3,
  reported_by_other: 2,
  inferred: 1,
  probable: 0,
};

/** True if `incoming` is at least as trustworthy as `existing` — ties broken by confidence, so a second `explicit` mention with higher confidence still counts as an upgrade. */
export function isStrongerEvidence(
  existing: { epistemicStatus: EpistemicStatus; confidence: number },
  incoming: { epistemicStatus: EpistemicStatus; confidence: number },
): boolean {
  const existingRank = EPISTEMIC_STRENGTH[existing.epistemicStatus];
  const incomingRank = EPISTEMIC_STRENGTH[incoming.epistemicStatus];
  if (incomingRank !== existingRank) return incomingRank > existingRank;
  return incoming.confidence > existing.confidence;
}

export interface RelationshipEvidenceInput {
  userId: string;
  fromEntityId: string;
  toEntityId: string;
  relationshipType: string;
  epistemicStatus: EpistemicStatus;
  confidence: number;
  extractionMethod: string;
  sourceMemoryId: string;
  evidenceText?: string;
}

export interface UpsertRelationshipResult {
  relationshipId: string;
  /** Whether this call created the entity_relationships edge itself (first time this exact (from,to,type) was ever seen for this user). */
  relationshipCreated: boolean;
  /** Whether this call added a new relationship_evidence row (false if this exact (relationship, memory) pairing had already been recorded — idempotent re-processing). */
  evidenceAdded: boolean;
  /** Whether the incoming evidence was strong enough to upgrade the relationship's rollup epistemicStatus/confidence/sourceMemoryId. */
  rollupUpgraded: boolean;
}

/**
 * The single, shared write path for "a memory evidences a relationship
 * between two entities" — used by the AI extraction pipeline and
 * available for any future relationship-producing path (a user
 * directly declaring a relationship, a different extraction method,
 * etc). Handles three cases in one atomic unit of work:
 *
 *   1. First time this (from, to, type) edge is seen for this user:
 *      creates the entity_relationships row AND a relationship_evidence
 *      row.
 *   2. Edge already exists, this exact memory hasn't evidenced it yet:
 *      adds a new relationship_evidence row (accumulating history —
 *      never overwrites or removes prior evidence), and upgrades the
 *      edge's rollup fields only if the new evidence is stronger.
 *   3. Edge already exists, this exact memory already evidenced it
 *      (e.g. re-processing): no-op, idempotent.
 *
 * Never deletes or overwrites existing evidence — this is the concrete
 * mechanism behind "preserve provenance" and "do not delete old
 * historical relationships" (Phase 7 items 2 and 8).
 */
export async function upsertRelationshipWithEvidence(
  tx: Queryable,
  input: RelationshipEvidenceInput,
): Promise<UpsertRelationshipResult> {
  const [existing] = await tx
    .select()
    .from(entityRelationships)
    .where(
      and(
        eq(entityRelationships.userId, input.userId),
        eq(entityRelationships.fromEntityId, input.fromEntityId),
        eq(entityRelationships.toEntityId, input.toEntityId),
        eq(entityRelationships.relationshipType, input.relationshipType),
      ),
    )
    .limit(1);

  let relationshipId: string;
  let relationshipCreated = false;
  let rollupUpgraded = false;

  if (!existing) {
    const [created] = await tx
      .insert(entityRelationships)
      .values({
        userId: input.userId,
        fromEntityId: input.fromEntityId,
        toEntityId: input.toEntityId,
        relationshipType: input.relationshipType,
        epistemicStatus: input.epistemicStatus,
        confidence: input.confidence.toFixed(2),
        extractionMethod: input.extractionMethod,
        sourceMemoryId: input.sourceMemoryId,
      })
      .returning({ id: entityRelationships.id });
    if (!created) {
      throw new Error('entity_relationships insert returned no row.');
    }
    relationshipId = created.id;
    relationshipCreated = true;
  } else {
    relationshipId = existing.id;
    const shouldUpgrade = isStrongerEvidence(
      { epistemicStatus: existing.epistemicStatus, confidence: Number(existing.confidence) },
      { epistemicStatus: input.epistemicStatus, confidence: input.confidence },
    );
    if (shouldUpgrade) {
      await tx
        .update(entityRelationships)
        .set({
          epistemicStatus: input.epistemicStatus,
          confidence: input.confidence.toFixed(2),
          extractionMethod: input.extractionMethod,
          sourceMemoryId: input.sourceMemoryId,
          updatedAt: new Date(),
        })
        .where(eq(entityRelationships.id, relationshipId));
      rollupUpgraded = true;
    } else {
      // Not strong enough to change the rollup, but a new piece of
      // evidence still arrived — bump updatedAt so "when was this edge
      // last reinforced" stays accurate without touching the rollup values.
      await tx.update(entityRelationships).set({ updatedAt: new Date() }).where(eq(entityRelationships.id, relationshipId));
    }
  }

  const [insertedEvidence] = await tx
    .insert(relationshipEvidence)
    .values({
      userId: input.userId,
      relationshipId,
      memoryId: input.sourceMemoryId,
      epistemicStatus: input.epistemicStatus,
      confidence: input.confidence.toFixed(2),
      extractionMethod: input.extractionMethod,
      evidenceText: input.evidenceText,
    })
    .onConflictDoNothing()
    .returning({ id: relationshipEvidence.id });

  return {
    relationshipId,
    relationshipCreated,
    evidenceAdded: Boolean(insertedEvidence),
    rollupUpgraded,
  };
}

/** All evidence for one relationship, newest first — the literal answer to "why does Twin think X is connected to Y". User-scoped; callers must have already verified the relationship belongs to this user. */
export async function getRelationshipEvidence(
  db: Queryable,
  userId: string,
  relationshipId: string,
): Promise<RelationshipEvidenceRow[]> {
  return db
    .select()
    .from(relationshipEvidence)
    .where(and(eq(relationshipEvidence.userId, userId), eq(relationshipEvidence.relationshipId, relationshipId)))
    .orderBy(desc(relationshipEvidence.createdAt));
}

/** Every relationship (either direction) attached to one entity, newest-updated first. */
export async function listEntityRelationships(
  db: Queryable,
  userId: string,
  entityId: string,
): Promise<EntityRelationshipRow[]> {
  return db
    .select()
    .from(entityRelationships)
    .where(
      and(
        eq(entityRelationships.userId, userId),
        or(eq(entityRelationships.fromEntityId, entityId), eq(entityRelationships.toEntityId, entityId)),
      ),
    )
    .orderBy(desc(entityRelationships.updatedAt));
}

/**
 * Every relationship touching ANY entity in `entityIds`, in one query —
 * used by the Context Engine (Phase 8) instead of calling
 * listEntityRelationships once per entity, which would be an N+1 query
 * pattern for a context request spanning many entities. Same shape as
 * traversal.service.ts's per-hop batched edge fetch. Deduplicated (a
 * relationship between two entities that are both in `entityIds` would
 * otherwise match the `or` condition once per row anyway, but this
 * keeps the contract explicit).
 */
export async function listRelationshipsAmongEntities(
  db: Queryable,
  userId: string,
  entityIds: string[],
): Promise<EntityRelationshipRow[]> {
  if (entityIds.length === 0) return [];
  const rows = await db
    .select()
    .from(entityRelationships)
    .where(
      and(
        eq(entityRelationships.userId, userId),
        or(inArray(entityRelationships.fromEntityId, entityIds), inArray(entityRelationships.toEntityId, entityIds)),
      ),
    )
    .orderBy(desc(entityRelationships.updatedAt));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return [...byId.values()];
}

/**
 * All evidence for every relationship in `relationshipIds`, in one
 * query — the batched counterpart to getRelationshipEvidence, used by
 * the Context Engine to avoid one evidence query per relationship.
 * Newest first within each relationship (callers group by relationshipId).
 */
export async function getRelationshipEvidenceBatch(
  db: Queryable,
  userId: string,
  relationshipIds: string[],
): Promise<RelationshipEvidenceRow[]> {
  if (relationshipIds.length === 0) return [];
  return db
    .select()
    .from(relationshipEvidence)
    .where(and(eq(relationshipEvidence.userId, userId), inArray(relationshipEvidence.relationshipId, relationshipIds)))
    .orderBy(desc(relationshipEvidence.createdAt));
}

export async function getRelationshipById(
  db: Queryable,
  userId: string,
  relationshipId: string,
): Promise<EntityRelationshipRow | undefined> {
  const [row] = await db
    .select()
    .from(entityRelationships)
    .where(and(eq(entityRelationships.id, relationshipId), eq(entityRelationships.userId, userId)))
    .limit(1);
  return row;
}

export class RelationshipError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** drizzle-orm's node-postgres driver wraps the real pg error in a DrizzleQueryError, with the actual error (carrying .code) on .cause — check both shapes defensively (same pattern as entities.service.ts's isUniqueViolation). */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code ?? (err as { cause?: { code?: unknown } })?.cause?.code;
  return code === '23505';
}

/**
 * Phase 27: a user directly connecting two of their OWN existing
 * entities — the counterpart to upsertRelationshipWithEvidence for the
 * one case that function structurally can't handle: there is no
 * source memory, because nothing was extracted from anything. Always
 * epistemicStatus='explicit' (the user directly stated this connection
 * exists, right now, by declaring it) and confidence=1.00 — never
 * inferred, never a guess. extractionMethod='user-declared' keeps this
 * distinguishable from AI-extracted edges in the exact same rollup
 * row, using the field that already exists for exactly this purpose.
 * sourceMemoryId stays null (the column already allows it) and no
 * relationship_evidence row is created — there is no memory to cite as
 * evidence, and inventing one would fabricate provenance.
 */
export async function createUserRelationship(
  db: Queryable,
  userId: string,
  input: { fromEntityId: string; toEntityId: string; relationshipType: string },
): Promise<EntityRelationshipRow> {
  if (input.fromEntityId === input.toEntityId) {
    throw new RelationshipError('An entity cannot be connected to itself.', 400);
  }
  try {
    const [created] = await db
      .insert(entityRelationships)
      .values({
        userId,
        fromEntityId: input.fromEntityId,
        toEntityId: input.toEntityId,
        relationshipType: input.relationshipType,
        epistemicStatus: 'explicit',
        confidence: '1.00',
        extractionMethod: 'user-declared',
        sourceMemoryId: null,
      })
      .returning();
    if (!created) {
      throw new Error('entity_relationships insert returned no row.');
    }
    return created;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new RelationshipError('This connection already exists.', 409);
    }
    throw err;
  }
}

/**
 * Deletes one relationship the caller owns. Cascades to that
 * relationship's own relationship_evidence rows only (the FK's
 * onDelete: 'cascade') — never touches the entities on either end, any
 * memory, or any other relationship. Ownership-checked via
 * getRelationshipById first so a cross-user id reads as "not found,"
 * never as "found but forbidden" (same posture as every other
 * ownership check in this codebase).
 */
export async function deleteRelationship(db: Queryable, userId: string, relationshipId: string): Promise<void> {
  const existing = await getRelationshipById(db, userId, relationshipId);
  if (!existing) {
    throw new RelationshipError(`Relationship not found: ${relationshipId}`, 404);
  }
  await db.delete(entityRelationships).where(eq(entityRelationships.id, relationshipId));
}
