import { and, desc, eq, ilike, inArray } from 'drizzle-orm';
import { entities, type Queryable } from '@twin/db';
import { findExactMatch } from '../graph/entityResolution.js';

export class EntityError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export type EntityRow = typeof entities.$inferSelect;

export interface CreateEntityInput {
  entityType: EntityRow['entityType'];
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface ListEntitiesFilter {
  entityType?: EntityRow['entityType'];
  name?: string;
}

/**
 * Plain functions rather than a db-bound factory (unlike auth.service)
 * because entity ownership checks need to run inside the *same*
 * transaction as memory creation — every function here takes its
 * query executor explicitly, so a caller can pass either the real
 * pooled `db` or an in-flight `tx`.
 */

export async function createEntity(db: Queryable, userId: string, input: CreateEntityInput): Promise<EntityRow> {
  const [entity] = await db
    .insert(entities)
    .values({
      userId,
      entityType: input.entityType,
      name: input.name,
      description: input.description,
      metadata: input.metadata ?? {},
    })
    .returning();

  if (!entity) {
    throw new Error('Entity insert returned no row.');
  }
  return entity;
}

/** Postgres unique_violation — see packages/db/migrations/0008_entity_name_normalization_unique.sql. */
const POSTGRES_UNIQUE_VIOLATION = '23505';

export interface FindOrCreateEntityResult {
  entity: EntityRow;
  wasCreated: boolean;
}

/**
 * Duplicate-safe entity creation — the resolve-or-create path every
 * caller that isn't doing its own batch resolution (the AI extraction
 * pipeline does its own via graph/entityResolution.ts's
 * planEntityResolution, since it's resolving many mentions against one
 * fetched entity list at once) should use instead of raw createEntity.
 *
 * Checks in-transaction first (cheap, handles the common case), but
 * the real safety net is the database's own unique index: if a
 * concurrent request wins a race and inserts the same normalized name
 * first, this catches that specific constraint violation and returns
 * the row that won instead of letting a raw Postgres error escape —
 * two concurrent "create Alex" calls can never produce two Alex
 * entities, regardless of timing.
 */
export async function findOrCreateEntity(db: Queryable, userId: string, input: CreateEntityInput): Promise<FindOrCreateEntityResult> {
  const existing = await listEntities(db, userId, { entityType: input.entityType });
  const match = findExactMatch(input.name, input.entityType, existing);
  if (match) {
    return { entity: match, wasCreated: false };
  }

  try {
    const entity = await createEntity(db, userId, input);
    return { entity, wasCreated: true };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const afterRace = await listEntities(db, userId, { entityType: input.entityType });
      const winner = findExactMatch(input.name, input.entityType, afterRace);
      if (winner) {
        return { entity: winner, wasCreated: false };
      }
    }
    throw err;
  }
}

/** drizzle-orm's node-postgres driver wraps the real pg error in a DrizzleQueryError, with the actual error (carrying .code) on .cause — check both shapes defensively. */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code ?? (err as { cause?: { code?: unknown } })?.cause?.code;
  return code === POSTGRES_UNIQUE_VIOLATION;
}

export async function listEntities(db: Queryable, userId: string, filter: ListEntitiesFilter): Promise<EntityRow[]> {
  const conditions = [eq(entities.userId, userId)];
  if (filter.entityType) {
    conditions.push(eq(entities.entityType, filter.entityType));
  }
  if (filter.name) {
    conditions.push(ilike(entities.name, `%${filter.name}%`));
  }

  return db
    .select()
    .from(entities)
    .where(and(...conditions))
    .orderBy(desc(entities.createdAt));
}

export async function getEntityById(db: Queryable, userId: string, entityId: string): Promise<EntityRow | undefined> {
  const [entity] = await db
    .select()
    .from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.userId, userId)))
    .limit(1);
  return entity;
}

/**
 * Confirms every id in `entityIds` exists and belongs to `userId` —
 * the isolation check that stops one user's memory being linked to
 * another user's entity. Throws EntityError (404) naming whichever
 * ids failed, rather than silently dropping them.
 */
export async function assertEntitiesOwnedByUser(db: Queryable, userId: string, entityIds: string[]): Promise<void> {
  if (entityIds.length === 0) return;

  const uniqueIds = [...new Set(entityIds)];
  const rows = await db
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.userId, userId), inArray(entities.id, uniqueIds)));

  const foundIds = new Set(rows.map((r) => r.id));
  const missing = uniqueIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    throw new EntityError(`Entity not found: ${missing.join(', ')}`, 404);
  }
}
