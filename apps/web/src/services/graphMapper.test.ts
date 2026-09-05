import { describe, expect, it } from 'vitest';
import type { EntityDto } from '@twin/contracts';
import {
  aggregateClusterCounts,
  buildEdgesFromTraversal,
  computeRadialLayout,
  deriveConnectedTo,
  toGraphNode,
} from './graphMapper';

function makeEntity(overrides: Partial<EntityDto> = {}): EntityDto {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    entityType: 'project',
    name: 'Project Nightingale',
    description: 'A research initiative.',
    metadata: {},
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('aggregateClusterCounts', () => {
  it('counts entities into their real cluster, in a fixed display order', () => {
    const entities = [
      makeEntity({ id: 'a', entityType: 'project' }),
      makeEntity({ id: 'b', entityType: 'person' }),
      makeEntity({ id: 'c', entityType: 'person' }),
      makeEntity({ id: 'd', entityType: 'goal' }),
      makeEntity({ id: 'e', entityType: 'decision' }),
    ];
    const result = aggregateClusterCounts(entities);
    expect(result).toEqual([
      { cluster: 'Projects', count: 1, icon: 'folder_open' },
      { cluster: 'People', count: 2, icon: 'group' },
      { cluster: 'Goals', count: 2, icon: 'flag' }, // goal + decision fold into one cluster
    ]);
  });

  it('omits a cluster entirely when it has zero entities — never a fake "0 active" card', () => {
    const result = aggregateClusterCounts([makeEntity({ entityType: 'project' })]);
    expect(result).toEqual([{ cluster: 'Projects', count: 1, icon: 'folder_open' }]);
    expect(result.some((c) => c.cluster === 'People')).toBe(false);
  });

  it('returns an empty array for an empty vault — an honest empty state, not fabricated clusters', () => {
    expect(aggregateClusterCounts([])).toEqual([]);
  });

  it('folds idea and event into one "Ideas & Events" cluster', () => {
    const result = aggregateClusterCounts([
      makeEntity({ id: 'a', entityType: 'idea' }),
      makeEntity({ id: 'b', entityType: 'event' }),
    ]);
    expect(result).toEqual([{ cluster: 'Ideas & Events', count: 2, icon: 'lightbulb' }]);
  });
});

describe('buildEdgesFromTraversal', () => {
  it('builds one edge per node with a real viaRelationship', () => {
    const nodes = [
      { viaRelationship: { fromEntityId: 'center', toEntityId: 'a' } },
      { viaRelationship: { fromEntityId: 'a', toEntityId: 'b' } },
    ];
    expect(buildEdgesFromTraversal(nodes)).toEqual([
      { fromId: 'center', toId: 'a' },
      { fromId: 'a', toId: 'b' },
    ]);
  });

  it('skips nodes with no viaRelationship rather than inventing an edge', () => {
    expect(buildEdgesFromTraversal([{ viaRelationship: null }])).toEqual([]);
  });

  it('deduplicates the same real relationship regardless of direction', () => {
    const nodes = [
      { viaRelationship: { fromEntityId: 'a', toEntityId: 'b' } },
      { viaRelationship: { fromEntityId: 'b', toEntityId: 'a' } },
    ];
    expect(buildEdgesFromTraversal(nodes)).toHaveLength(1);
  });

  it('returns an empty array for an empty traversal', () => {
    expect(buildEdgesFromTraversal([])).toEqual([]);
  });
});

describe('deriveConnectedTo', () => {
  const edges = [
    { fromId: 'center', toId: 'a' },
    { fromId: 'b', toId: 'center' },
    { fromId: 'a', toId: 'c' },
  ];

  it('finds neighbors regardless of edge direction', () => {
    expect(new Set(deriveConnectedTo('center', edges))).toEqual(new Set(['a', 'b']));
  });

  it('returns an empty array for a node with no edges', () => {
    expect(deriveConnectedTo('isolated-node', edges)).toEqual([]);
  });

  it('never includes the node itself', () => {
    expect(deriveConnectedTo('center', edges)).not.toContain('center');
  });
});

describe('computeRadialLayout', () => {
  it('places the center entity at (50, 50)', () => {
    const layout = computeRadialLayout('center', []);
    expect(layout['center']).toEqual({ x: 50, y: 50 });
  });

  it('places hop-1 neighbors closer to center than hop-2 neighbors', () => {
    const layout = computeRadialLayout('center', [
      { id: 'near', hopDistance: 1 },
      { id: 'far', hopDistance: 2 },
    ]);
    const dist = (p: { x: number; y: number }) => Math.hypot(p.x - 50, p.y - 50);
    expect(dist(layout['near']!)).toBeLessThan(dist(layout['far']!));
  });

  it('is deterministic — same input always produces the same output', () => {
    const neighbors = [
      { id: 'bbbbbbbb-0000-0000-0000-000000000002', hopDistance: 1 },
      { id: 'aaaaaaaa-0000-0000-0000-000000000001', hopDistance: 1 },
      { id: 'cccccccc-0000-0000-0000-000000000003', hopDistance: 2 },
    ];
    expect(computeRadialLayout('center', neighbors)).toEqual(computeRadialLayout('center', neighbors));
  });

  it('never places a node outside the 0-100 canvas coordinate space', () => {
    const neighbors = Array.from({ length: 12 }, (_, i) => ({ id: `node-${i}`, hopDistance: (i % 2) + 1 }));
    const layout = computeRadialLayout('center', neighbors);
    for (const point of Object.values(layout)) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(100);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(100);
    }
  });

  it('never double-places the center id even if it also appears in the neighbor list', () => {
    const layout = computeRadialLayout('center', [{ id: 'center', hopDistance: 1 }]);
    expect(layout['center']).toEqual({ x: 50, y: 50 });
    expect(Object.keys(layout)).toEqual(['center']);
  });

  it('handles a single neighbor without dividing by zero', () => {
    const layout = computeRadialLayout('center', [{ id: 'only', hopDistance: 1 }]);
    expect(Number.isFinite(layout['only']!.x)).toBe(true);
    expect(Number.isFinite(layout['only']!.y)).toBe(true);
  });
});

describe('toGraphNode', () => {
  it('maps every real EntityDto field to the GraphNode shape, never fabricating a value', () => {
    const entity = makeEntity({ entityType: 'person', name: 'Jordan Rivera', description: 'A collaborator.' });
    const node = toGraphNode(entity, { connectedTo: ['x'], point: { x: 10, y: 20 } });
    const expectedLastActive = new Date(entity.updatedAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    expect(node).toEqual({
      id: entity.id,
      name: 'Jordan Rivera',
      type: 'person',
      cluster: 'People',
      description: 'A collaborator.',
      icon: 'person',
      color: '#ffb785',
      connectedTo: ['x'],
      lastActive: expectedLastActive,
      x: 10,
      y: 20,
    });
  });

  it('falls back to an honest placeholder when the entity has no description, never inventing one', () => {
    const node = toGraphNode(makeEntity({ description: null }));
    expect(node.description).toBe('No description recorded yet.');
  });

  it('defaults connectedTo to an empty array and leaves position undefined when not provided', () => {
    const node = toGraphNode(makeEntity());
    expect(node.connectedTo).toEqual([]);
    expect(node.x).toBeUndefined();
    expect(node.y).toBeUndefined();
  });
});
