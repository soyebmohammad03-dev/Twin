import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { decisions, entities, entityRelationships, memories, memoryEntities, type Queryable, type Database } from '@twin/db';
import { createEntity, getEntityById, type EntityRow } from '../entities/entities.service.js';

export class DecisionError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export type DecisionRow = typeof decisions.$inferSelect;

export interface DecisionWithEntity {
  entity: EntityRow;
  decision: DecisionRow;
}

export interface CreateDecisionInput {
  name: string;
  description?: string;
  status?: DecisionRow['status'];
  outcome?: string;
  decidedAt?: Date;
}

export interface UpdateDecisionInput {
  status?: DecisionRow['status'];
  outcome?: string | null;
  decidedAt?: Date | null;
}

/**
 * Creates the `entities` row and its `decisions` subtype row together,
 * atomically. Before this phase nothing populated the subtype table at
 * all (see decisions.ts's schema comment and
 * ingestion/extraction/pipeline.ts's storeExtractionResult) — every
 * decision entity was structurally indistinguishable from a bare
 * entity. This is the smallest fix: always create both rows, in one
 * transaction, so a decision entity can never exist without its status.
 */
export async function createDecision(db: Database, userId: string, input: CreateDecisionInput): Promise<DecisionWithEntity> {
  return db.transaction(async (tx) => {
    const entity = await createEntity(tx, userId, {
      entityType: 'decision',
      name: input.name,
      description: input.description,
    });

    // Same "decided defaults decidedAt to now()" rule as updateDecision —
    // recording a decision the user already made shouldn't require a
    // second PATCH just to get the date right.
    const decidedAt =
      input.decidedAt ?? (input.status === 'decided' ? new Date() : undefined);

    const [decision] = await tx
      .insert(decisions)
      .values({
        entityId: entity.id,
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
        ...(decidedAt !== undefined ? { decidedAt } : {}),
      })
      .returning();
    if (!decision) {
      throw new Error('Decision insert returned no row.');
    }
    return { entity, decision };
  });
}

/** Every decision entity belonging to userId, most recently updated first. */
export async function listDecisions(db: Queryable, userId: string): Promise<DecisionWithEntity[]> {
  const rows = await db
    .select({ entity: entities, decision: decisions })
    .from(entities)
    .innerJoin(decisions, eq(decisions.entityId, entities.id))
    .where(and(eq(entities.userId, userId), eq(entities.entityType, 'decision')))
    .orderBy(desc(entities.updatedAt));
  return rows;
}

/**
 * Which of the given decision entity ids have ANY recorded evidence — a
 * graph relationship (either direction) or a linked, non-deleted
 * memory. Two bounded queries (never per-row), so the list screen can
 * show an honest "no evidence yet" badge without an N+1 fetch.
 */
export async function decisionIdsWithEvidence(db: Queryable, userId: string, entityIds: string[]): Promise<Set<string>> {
  if (entityIds.length === 0) return new Set();

  const [relRows, memRows] = await Promise.all([
    db
      .select({ id: entityRelationships.fromEntityId, toId: entityRelationships.toEntityId })
      .from(entityRelationships)
      .where(
        and(
          eq(entityRelationships.userId, userId),
          or(inArray(entityRelationships.fromEntityId, entityIds), inArray(entityRelationships.toEntityId, entityIds)),
        ),
      ),
    db
      .select({ entityId: memoryEntities.entityId })
      .from(memoryEntities)
      .innerJoin(memories, eq(memoryEntities.memoryId, memories.id))
      .where(and(eq(memories.userId, userId), inArray(memoryEntities.entityId, entityIds), isNull(memories.deletedAt))),
  ]);

  const withEvidence = new Set<string>();
  for (const row of relRows) {
    if (entityIds.includes(row.id)) withEvidence.add(row.id);
    if (entityIds.includes(row.toId)) withEvidence.add(row.toId);
  }
  for (const row of memRows) withEvidence.add(row.entityId);
  return withEvidence;
}

/**
 * Fetches one decision, verifying both that the entity belongs to
 * userId AND is actually entityType='decision' — a person/project id
 * passed here is treated as not-found, not as "not a decision" (same
 * user-isolation-first posture as entities.service.getEntityById).
 */
export async function getDecisionById(db: Queryable, userId: string, entityId: string): Promise<DecisionWithEntity> {
  const entity = await getEntityById(db, userId, entityId);
  if (!entity || entity.entityType !== 'decision') {
    throw new DecisionError(`Decision not found: ${entityId}`, 404);
  }

  const [decision] = await db.select().from(decisions).where(eq(decisions.entityId, entityId)).limit(1);
  if (!decision) {
    // Should be unreachable now that createDecision always inserts both
    // rows together — surfaced loudly rather than silently defaulted,
    // since it would mean a decision entity exists without its subtype
    // row (e.g. one created before this phase, outside createDecision).
    throw new DecisionError(`Decision ${entityId} has no decision record.`, 404);
  }

  return { entity, decision };
}

/**
 * Patch semantics: only the fields the caller explicitly provided are
 * changed. If status is being set to 'decided' and the caller didn't
 * separately specify decidedAt, decidedAt defaults to now() — recording
 * *when the status changed*, not inventing any content about the
 * decision itself.
 */
export async function updateDecision(
  db: Queryable,
  userId: string,
  entityId: string,
  input: UpdateDecisionInput,
): Promise<DecisionWithEntity> {
  const { entity } = await getDecisionById(db, userId, entityId);

  const patch: Partial<typeof decisions.$inferInsert> = {};
  if (input.status !== undefined) {
    patch.status = input.status;
    if (input.status === 'decided' && input.decidedAt === undefined) {
      patch.decidedAt = new Date();
    }
  }
  if (input.outcome !== undefined) patch.outcome = input.outcome;
  if (input.decidedAt !== undefined) patch.decidedAt = input.decidedAt;

  if (Object.keys(patch).length === 0) {
    const [decision] = await db.select().from(decisions).where(eq(decisions.entityId, entityId)).limit(1);
    return { entity, decision: decision! };
  }

  const [decision] = await db.update(decisions).set(patch).where(eq(decisions.entityId, entityId)).returning();
  if (!decision) {
    throw new Error(`Decision update returned no row for ${entityId}.`);
  }
  return { entity, decision };
}
