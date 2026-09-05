import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { entities, entityRelationships, type Queryable } from '@twin/db';
import type { EntityRow } from '../entities/entities.service.js';

/** Hard ceiling — item 6 explicitly forbids unbounded traversal. Callers may ask for fewer hops, never more. */
export const MAX_TRAVERSAL_HOPS = 2;

export interface TraversalNode {
  entity: EntityRow;
  hopDistance: number;
  /** The specific edge that reached this node from its nearest already-visited neighbor — null for the starting entity itself. */
  viaRelationship?: {
    id: string;
    relationshipType: string;
    direction: 'outgoing' | 'incoming';
    fromEntityId: string;
    toEntityId: string;
  };
}

export interface TraverseOptions {
  /** 1 or 2 — see MAX_TRAVERSAL_HOPS. */
  hops: 1 | 2;
  includeArchived?: boolean;
}

/**
 * Bounded breadth-first traversal outward from one entity, scoped to a
 * single user. Guarantees:
 *
 *   - never visits more than `hops` steps from the start (hard-capped
 *     at MAX_TRAVERSAL_HOPS regardless of what a caller requests)
 *   - never revisits a node — a `visited` set makes this cycle-safe;
 *     a relationship loop (A -> B -> A) simply stops expanding once
 *     both ends are already visited, it can never recurse forever
 *   - deterministic ordering — nodes are returned sorted by
 *     (hopDistance ASC, entityType ASC, name ASC, id ASC), so the same
 *     graph always produces the same result list
 *   - user-scoped — every query filters on userId; there is no code
 *     path here that can cross into another user's entities or edges
 *   - excludes archived entities by default (the starting entity may
 *     be archived if the caller explicitly asked for its detail, but
 *     traversal will not walk further through other archived nodes)
 *
 * One SQL round trip per hop (not per node) — hop 1 fetches every edge
 * touching the start entity in one query, hop 2 fetches every edge
 * touching the resulting frontier in one more query. Bounded by
 * MAX_TRAVERSAL_HOPS, so this is at most 2 extra queries no matter how
 * large the graph is.
 */
export async function traverseFromEntity(
  db: Queryable,
  userId: string,
  startEntityId: string,
  options: TraverseOptions,
): Promise<TraversalNode[]> {
  const hops = Math.min(options.hops, MAX_TRAVERSAL_HOPS);
  const includeArchived = options.includeArchived ?? false;

  const [start] = await db
    .select()
    .from(entities)
    .where(and(eq(entities.id, startEntityId), eq(entities.userId, userId)))
    .limit(1);
  if (!start) return [];

  const visited = new Map<string, TraversalNode>();
  visited.set(start.id, { entity: start, hopDistance: 0 });

  let frontier = [start.id];

  for (let hop = 1; hop <= hops && frontier.length > 0; hop++) {
    const edges = await db
      .select()
      .from(entityRelationships)
      .where(
        and(
          eq(entityRelationships.userId, userId),
          or(inArray(entityRelationships.fromEntityId, frontier), inArray(entityRelationships.toEntityId, frontier)),
        ),
      );

    const nextFrontierIds = new Set<string>();
    const viaByEntityId = new Map<string, TraversalNode['viaRelationship']>();

    for (const edge of edges) {
      const fromInFrontier = frontier.includes(edge.fromEntityId);
      const toInFrontier = frontier.includes(edge.toEntityId);
      // Skip edges entirely internal to already-visited nodes (this is
      // exactly the cycle-protection: a back-edge to a visited node
      // never re-queues it or extends the frontier).
      if (fromInFrontier && !visited.has(edge.toEntityId)) {
        nextFrontierIds.add(edge.toEntityId);
        if (!viaByEntityId.has(edge.toEntityId)) {
          viaByEntityId.set(edge.toEntityId, {
            id: edge.id,
            relationshipType: edge.relationshipType,
            direction: 'outgoing',
            fromEntityId: edge.fromEntityId,
            toEntityId: edge.toEntityId,
          });
        }
      }
      if (toInFrontier && !visited.has(edge.fromEntityId)) {
        nextFrontierIds.add(edge.fromEntityId);
        if (!viaByEntityId.has(edge.fromEntityId)) {
          viaByEntityId.set(edge.fromEntityId, {
            id: edge.id,
            relationshipType: edge.relationshipType,
            direction: 'incoming',
            fromEntityId: edge.fromEntityId,
            toEntityId: edge.toEntityId,
          });
        }
      }
    }

    if (nextFrontierIds.size === 0) break;

    const newEntityConditions = [eq(entities.userId, userId), inArray(entities.id, [...nextFrontierIds])];
    if (!includeArchived) newEntityConditions.push(isNull(entities.archivedAt));
    const newEntities = await db
      .select()
      .from(entities)
      .where(and(...newEntityConditions));

    for (const entity of newEntities) {
      if (visited.has(entity.id)) continue; // defensive; nextFrontierIds already excludes visited
      visited.set(entity.id, { entity, hopDistance: hop, viaRelationship: viaByEntityId.get(entity.id) });
    }

    frontier = newEntities.map((e) => e.id);
  }

  const results = [...visited.values()].filter((node) => node.entity.id !== start.id);
  results.sort((a, b) => {
    if (a.hopDistance !== b.hopDistance) return a.hopDistance - b.hopDistance;
    if (a.entity.entityType !== b.entity.entityType) return a.entity.entityType.localeCompare(b.entity.entityType);
    if (a.entity.name !== b.entity.name) return a.entity.name.localeCompare(b.entity.name);
    return a.entity.id.localeCompare(b.entity.id);
  });
  return results;
}
