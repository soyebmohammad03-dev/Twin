/**
 * Phase 21 — pure, no-network adapters between the real Knowledge
 * Graph API (EntityDto / RelatedEntitiesResponse, from
 * apps/api/src/modules/graph and .../entities) and ExploreView's
 * existing GraphNode UI shape (types.ts). Mirrors memoryMapper.ts's
 * role for the Memory API: the view components stay unaware of the
 * DTO shape, and every value here traces back to a real field —
 * nothing is invented, randomized, or hardcoded per-entity.
 *
 * Kept pure and dependency-free (no fetch, no React) specifically so
 * it's unit-testable with the monorepo's existing vitest setup — see
 * graphMapper.test.ts — without needing a browser/DOM environment.
 */

import type { EntityDto, EntityType } from '@twin/contracts';
import type { GraphNode } from '../types';

export type ExploreCluster = 'Projects' | 'People' | 'Goals' | 'Ideas & Events';

export const ENTITY_TYPE_ICON: Record<EntityType, string> = {
  person: 'person',
  project: 'rocket_launch',
  goal: 'flag',
  decision: 'account_balance_wallet',
  idea: 'lightbulb',
  event: 'event',
};

export const ENTITY_TYPE_COLOR: Record<EntityType, string> = {
  person: '#ffb785',
  project: '#818cf8',
  goal: '#34c759',
  decision: '#ffb785',
  idea: '#c2c1ff',
  event: '#60a5fa',
};

export const ENTITY_TYPE_CLUSTER: Record<EntityType, ExploreCluster> = {
  person: 'People',
  project: 'Projects',
  goal: 'Goals',
  decision: 'Goals',
  idea: 'Ideas & Events',
  event: 'Ideas & Events',
};

const CLUSTER_ICON: Record<ExploreCluster, string> = {
  Projects: 'folder_open',
  People: 'group',
  Goals: 'flag',
  'Ideas & Events': 'lightbulb',
};

/** Fixed, deterministic display order — not derived from counts, so the panel doesn't reorder itself as data changes. */
const CLUSTER_ORDER: ExploreCluster[] = ['Projects', 'People', 'Goals', 'Ideas & Events'];

export interface ClusterSummary {
  cluster: ExploreCluster;
  count: number;
  icon: string;
}

/**
 * Real counts only — a cluster with zero entities is omitted rather
 * than rendered as a fake "0 active" card. This is the honest-empty-
 * state behavior for the side panel: a brand-new vault with only
 * projects shows only a Projects card, not three decorative zeros.
 */
export function aggregateClusterCounts(entities: EntityDto[]): ClusterSummary[] {
  const counts = new Map<ExploreCluster, number>();
  for (const entity of entities) {
    const cluster = ENTITY_TYPE_CLUSTER[entity.entityType];
    counts.set(cluster, (counts.get(cluster) ?? 0) + 1);
  }
  return CLUSTER_ORDER.filter((cluster) => (counts.get(cluster) ?? 0) > 0).map((cluster) => ({
    cluster,
    count: counts.get(cluster) ?? 0,
    icon: CLUSTER_ICON[cluster],
  }));
}

function formatEntityDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export interface GraphEdge {
  fromId: string;
  toId: string;
}

/**
 * Every edge in a RelatedEntitiesResponse's traversal, deduplicated
 * (undirected — the same real relationship visited from either end
 * counts once). Built directly from each node's `viaRelationship`,
 * which is the real edge that reached it during the backend's bounded
 * BFS (traversal.service.ts) — never inferred or guessed.
 */
export function buildEdgesFromTraversal(nodes: { viaRelationship: { fromEntityId: string; toEntityId: string } | null }[]): GraphEdge[] {
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const node of nodes) {
    if (!node.viaRelationship) continue;
    const { fromEntityId, toEntityId } = node.viaRelationship;
    const key = [fromEntityId, toEntityId].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ fromId: fromEntityId, toId: toEntityId });
  }
  return edges;
}

export function deriveConnectedTo(nodeId: string, edges: GraphEdge[]): string[] {
  const connected = new Set<string>();
  for (const edge of edges) {
    if (edge.fromId === nodeId) connected.add(edge.toId);
    if (edge.toId === nodeId) connected.add(edge.fromId);
  }
  return [...connected];
}

export interface LayoutPoint {
  x: number;
  y: number;
}

const CENTER: LayoutPoint = { x: 50, y: 50 };
/** Percentage-of-canvas radius per hop distance — matches the 0-100 coordinate space ExploreView's canvas already renders nodes in (`left-[X%] top-[Y%]`). Capped well inside 0-100 so a node never renders off-canvas. */
const HOP_RADIUS: Record<number, number> = { 1: 30, 2: 44 };
const DEFAULT_RADIUS = 44;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Deterministic radial layout: the focus entity at the canvas center,
 * its hop-1 neighbors evenly spaced on one ring, hop-2 neighbors on a
 * wider ring — a real, if simplified, graph layout (not a hardcoded
 * scene), and pure/testable since it depends only on hop distances and
 * ids (sorted for a stable order), never on render timing or randomness.
 */
export function computeRadialLayout(
  centerId: string,
  neighbors: { id: string; hopDistance: number }[],
): Record<string, LayoutPoint> {
  const layout: Record<string, LayoutPoint> = { [centerId]: { ...CENTER } };

  const byHop = new Map<number, string[]>();
  for (const node of neighbors) {
    if (node.id === centerId) continue;
    const list = byHop.get(node.hopDistance) ?? [];
    list.push(node.id);
    byHop.set(node.hopDistance, list);
  }

  for (const [hop, ids] of byHop) {
    const radius = HOP_RADIUS[hop] ?? DEFAULT_RADIUS;
    const sorted = [...ids].sort((a, b) => a.localeCompare(b));
    const count = sorted.length;
    // Each hop ring starts at a different angle (golden-angle-derived
    // offset, keyed only by the hop number — still fully deterministic)
    // so a single-member ring doesn't land directly above a
    // single-member ring at another hop distance, which otherwise
    // renders as a visually confusing straight vertical stack.
    const ringOffset = (hop * 2.399963) % (2 * Math.PI);
    sorted.forEach((id, index) => {
      const angle = (2 * Math.PI * index) / count - Math.PI / 2 + ringOffset;
      layout[id] = {
        x: clamp(CENTER.x + radius * Math.cos(angle), 4, 96),
        y: clamp(CENTER.y + radius * Math.sin(angle), 4, 96),
      };
    });
  }

  return layout;
}

export function toGraphNode(entity: EntityDto, opts: { connectedTo?: string[]; point?: LayoutPoint } = {}): GraphNode {
  return {
    id: entity.id,
    name: entity.name,
    type: entity.entityType,
    cluster: ENTITY_TYPE_CLUSTER[entity.entityType],
    description: entity.description ?? 'No description recorded yet.',
    icon: ENTITY_TYPE_ICON[entity.entityType],
    color: ENTITY_TYPE_COLOR[entity.entityType],
    connectedTo: opts.connectedTo ?? [],
    lastActive: formatEntityDate(entity.updatedAt),
    x: opts.point?.x,
    y: opts.point?.y,
  };
}
