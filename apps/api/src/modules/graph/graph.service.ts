import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { memories, memoryEntities, type Queryable } from '@twin/db';
import type { EntitySubtype } from '@twin/contracts';
import { getEntityById, getEntitySubtype, type EntityRow } from '../entities/entities.service.js';
import type { MemoryWithRelations } from '../memories/memories.service.js';
import {
  listEntityRelationships,
  getRelationshipById,
  getRelationshipEvidence,
  type EntityRelationshipRow,
  type RelationshipEvidenceRow,
} from './relationships.service.js';
import { traverseFromEntity, type TraversalNode, type TraverseOptions } from './traversal.service.js';

export class GraphError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 404) {
    super(message);
    this.statusCode = statusCode;
  }
}

export interface RelationshipWithConnectedEntity {
  relationship: EntityRelationshipRow;
  /** The entity at the OTHER end of the edge from the one being inspected. */
  connectedEntity: EntityRow;
  direction: 'outgoing' | 'incoming';
}

export interface EntityDetail {
  entity: EntityRow;
  /** Phase 40: the entity's real 1:1 subtype data (project status/dates, goal status/targetDate, event startsAt/endsAt/location, etc.) when its type has one and a row exists — null otherwise, never fabricated. */
  subtype: EntitySubtype | null;
  relationships: RelationshipWithConnectedEntity[];
  supportingMemories: MemoryWithRelations[];
}

/**
 * Everything the frontend's entity detail panel needs in one call: the
 * entity itself, every relationship it participates in (with the
 * entity at the other end resolved, so the UI never has to make a
 * second round trip per edge), and every non-archived memory directly
 * linked to it. Fully user-scoped — throws GraphError(404) rather than
 * returning another user's entity if the id doesn't belong to userId.
 */
export async function getEntityDetail(db: Queryable, userId: string, entityId: string): Promise<EntityDetail> {
  const entity = await getEntityById(db, userId, entityId);
  if (!entity) {
    throw new GraphError(`Entity not found: ${entityId}`, 404);
  }

  const relationshipRows = await listEntityRelationships(db, userId, entityId);
  const connectedIds = new Set<string>();
  for (const rel of relationshipRows) {
    connectedIds.add(rel.fromEntityId === entityId ? rel.toEntityId : rel.fromEntityId);
  }

  const connectedEntities = await Promise.all([...connectedIds].map((id) => getEntityById(db, userId, id)));
  const connectedById = new Map(connectedEntities.filter((e): e is EntityRow => Boolean(e)).map((e) => [e.id, e]));

  const relationships: RelationshipWithConnectedEntity[] = relationshipRows
    .map((relationship) => {
      const isOutgoing = relationship.fromEntityId === entityId;
      const connectedEntity = connectedById.get(isOutgoing ? relationship.toEntityId : relationship.fromEntityId);
      if (!connectedEntity) return null; // connected entity belongs to another user or was hard-deleted — skip rather than error
      return { relationship, connectedEntity, direction: isOutgoing ? ('outgoing' as const) : ('incoming' as const) };
    })
    .filter((r): r is RelationshipWithConnectedEntity => r !== null);

  const supportingMemories = await getSupportingMemories(db, userId, entityId);
  const subtype = await getEntitySubtype(db, entity.entityType, entityId);

  return { entity, subtype, relationships, supportingMemories };
}

/** Every non-archived memory directly linked to this entity (via memory_entities), most recent first. */
export async function getSupportingMemories(db: Queryable, userId: string, entityId: string): Promise<MemoryWithRelations[]> {
  const links = await db
    .select({ memoryId: memoryEntities.memoryId })
    .from(memoryEntities)
    .innerJoin(memories, eq(memoryEntities.memoryId, memories.id))
    .where(and(eq(memories.userId, userId), eq(memoryEntities.entityId, entityId)));

  if (links.length === 0) return [];
  const linkedIds = [...new Set(links.map((l) => l.memoryId))];

  const result = await db.query.memories.findMany({
    where: and(eq(memories.userId, userId), inArray(memories.id, linkedIds), isNull(memories.deletedAt)),
    with: { source: true, entityLinks: { with: { entity: true } } },
    orderBy: [desc(memories.createdAt)],
  });
  return result as MemoryWithRelations[];
}

export interface RelatedEntitiesResult {
  entity: EntityRow;
  nodes: TraversalNode[];
}

/** Bounded traversal outward from one entity — see traversal.service.ts for the guarantees (hop limit, cycle safety, determinism, user scope). */
export async function getRelatedEntities(
  db: Queryable,
  userId: string,
  entityId: string,
  options: TraverseOptions,
): Promise<RelatedEntitiesResult> {
  const entity = await getEntityById(db, userId, entityId);
  if (!entity) {
    throw new GraphError(`Entity not found: ${entityId}`, 404);
  }
  const nodes = await traverseFromEntity(db, userId, entityId, options);
  return { entity, nodes };
}

export interface RelationshipEvidenceResult {
  relationship: EntityRelationshipRow;
  fromEntity: EntityRow;
  toEntity: EntityRow;
  evidence: (RelationshipEvidenceRow & { memory: MemoryWithRelations | null })[];
}

/**
 * The concrete "why does Twin think X is connected to Y" answer (item
 * 3) — the relationship's rollup fields plus every individual piece of
 * evidence, each with its originating memory attached (or null if that
 * specific memory was later hard-deleted; the evidence text itself is
 * still preserved even then). Generated entirely from stored rows —
 * nothing here is an LLM call or an invented explanation.
 */
export async function getRelationshipEvidenceDetail(
  db: Queryable,
  userId: string,
  relationshipId: string,
): Promise<RelationshipEvidenceResult> {
  const relationship = await getRelationshipById(db, userId, relationshipId);
  if (!relationship) {
    throw new GraphError(`Relationship not found: ${relationshipId}`, 404);
  }

  const [fromEntity, toEntity, evidenceRows] = await Promise.all([
    getEntityById(db, userId, relationship.fromEntityId),
    getEntityById(db, userId, relationship.toEntityId),
    getRelationshipEvidence(db, userId, relationshipId),
  ]);

  if (!fromEntity || !toEntity) {
    throw new GraphError('Relationship references an entity that no longer exists.', 404);
  }

  const memoryIds = [...new Set(evidenceRows.map((e) => e.memoryId))];
  const memoryRows =
    memoryIds.length > 0
      ? ((await db.query.memories.findMany({
          where: and(eq(memories.userId, userId), inArray(memories.id, memoryIds)),
          with: { source: true, entityLinks: { with: { entity: true } } },
        })) as MemoryWithRelations[])
      : [];
  const memoryById = new Map(memoryRows.map((m) => [m.id, m]));

  const evidence = evidenceRows.map((row) => ({ ...row, memory: memoryById.get(row.memoryId) ?? null }));

  return { relationship, fromEntity, toEntity, evidence };
}
