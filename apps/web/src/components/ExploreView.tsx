import React, { useMemo } from 'react';
import type { EntityDto } from '@twin/contracts';
import { GraphNode } from '../types';
import {
  aggregateClusterCounts,
  buildEdgesFromTraversal,
  computeRadialLayout,
  deriveConnectedTo,
  ENTITY_TYPE_CLUSTER,
  toGraphNode,
} from '../services/graphMapper';
import type { ExploreCluster, GraphEdge } from '../services/graphMapper';

interface ExploreViewProps {
  /** The user's real entities (people/projects/goals/decisions/ideas/events) — GET /entities, unfiltered. */
  entities: EntityDto[];
  isEntitiesLoading: boolean;
  /** The entity currently centered in the graph canvas, or null if the vault has no entities yet. */
  focusEntityId: string | null;
  onSelectFocusEntity: (id: string) => void;
  /** Real bounded traversal (GET /entities/:id/related) for focusEntityId, or null while none has loaded yet. */
  relatedNodes: { entity: EntityDto; hopDistance: number; viaRelationship: { fromEntityId: string; toEntityId: string } | null }[] | null;
  isRelatedLoading: boolean;
  onDeepExploration: () => void;
  onAskAboutNode: (node: GraphNode) => void;
  /** Phase 28: opens the existing EntityDetailModal for a real graph node — no second entity-detail implementation. */
  onInspectNode: (node: GraphNode) => void;
  /** Phase 34: opens CreateEntityModal — the intentional "I already know this should exist" entry point. */
  onCreateEntity: () => void;
}

/**
 * Phase 21: Explore's real Knowledge Graph — replaces the previous
 * hardcoded "Project Helios / Sarah Jenkins / Budget Decision" scene
 * with the user's actual entities and real bounded graph traversal
 * (apps/api/src/modules/graph), reusing the exact same endpoints
 * EntityDetailModal already relies on. Node positions are computed
 * (services/graphMapper.ts's computeRadialLayout), not hand-placed;
 * every node, edge, and count on this screen traces back to a real
 * entity or relationship — a vault with nothing in it yet renders an
 * honest empty state, never fabricated placeholder nodes.
 */
export const ExploreView: React.FC<ExploreViewProps> = ({
  entities,
  isEntitiesLoading,
  focusEntityId,
  onSelectFocusEntity,
  relatedNodes,
  isRelatedLoading,
  onDeepExploration,
  onAskAboutNode,
  onInspectNode,
  onCreateEntity,
}) => {
  const [activeClusterFilter, setActiveClusterFilter] = React.useState<ExploreCluster | 'all'>('all');

  const clusterSummaries = useMemo(() => aggregateClusterCounts(entities), [entities]);

  const { canvasNodes, edges } = useMemo(() => {
    if (!focusEntityId) return { canvasNodes: [] as GraphNode[], edges: [] as GraphEdge[] };
    const focusEntity = entities.find((e) => e.id === focusEntityId);
    if (!focusEntity) return { canvasNodes: [] as GraphNode[], edges: [] as GraphEdge[] };

    // Defensive: never render the focus entity a second time as its own
    // "neighbor" — guards against a stale/in-flight relatedNodes response
    // for a previously-focused entity that happened to list the entity
    // now focused, which would otherwise produce a duplicate React key.
    const neighbors = (relatedNodes ?? []).filter((n) => n.entity.id !== focusEntityId);
    const layout = computeRadialLayout(
      focusEntityId,
      neighbors.map((n) => ({ id: n.entity.id, hopDistance: n.hopDistance })),
    );
    const builtEdges = buildEdgesFromTraversal(neighbors);

    const nodes: GraphNode[] = [
      toGraphNode(focusEntity, { point: layout[focusEntityId], connectedTo: deriveConnectedTo(focusEntityId, builtEdges) }),
      ...neighbors.map((n) =>
        toGraphNode(n.entity, { point: layout[n.entity.id], connectedTo: deriveConnectedTo(n.entity.id, builtEdges) }),
      ),
    ];
    return { canvasNodes: nodes, edges: builtEdges };
  }, [focusEntityId, relatedNodes, entities]);

  const selectedNode = canvasNodes.find((n) => n.id === focusEntityId) ?? canvasNodes[0];

  const pickerEntities = useMemo(
    () => entities.filter((e) => activeClusterFilter === 'all' || ENTITY_TYPE_CLUSTER[e.entityType] === activeClusterFilter),
    [entities, activeClusterFilter],
  );

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full pb-32 pt-2">
      {/* View Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full liquid-glass text-xs font-mono text-[#4f4ccd] dark:text-[#c2c1ff] border border-indigo-500/30 mb-2">
            <span className="material-symbols-outlined text-[14px]">hub</span>
            <span>Knowledge Graph</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Explore Clusters</h1>
          <p className="text-sm text-slate-600 dark:text-[#c7c4d6]/80 mt-1">
            Uncover the real relationships Twin has recorded between people, projects, ideas, decisions, and goals.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={onCreateEntity}
            className="liquid-glass px-4 py-2.5 rounded-full flex items-center gap-1.5 hover:bg-indigo-500/10 transition-all border border-slate-200/80 dark:border-white/10 shadow-sm active:scale-95 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px] text-indigo-500 dark:text-indigo-400">add</span>
            <span className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-white">Add</span>
          </button>
          <button
            onClick={onDeepExploration}
            className="liquid-glass-heavy px-5 py-2.5 rounded-full flex items-center gap-2 hover:bg-indigo-500/20 transition-all border border-indigo-500/40 shadow-lg group active:scale-95 cursor-pointer"
          >
            <span className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-[#c2c1ff]">Deep Exploration</span>
            <span className="material-symbols-outlined text-[18px] text-indigo-500 dark:text-[#c2c1ff] group-hover:translate-x-1 transition-transform">
              arrow_forward
            </span>
          </button>
        </div>
      </div>

      {/* Main Grid: Interactive Canvas & Side Clusters */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Interactive Knowledge Graph Canvas */}
        <div className="lg:col-span-8 liquid-glass rounded-3xl p-5 sm:p-6 min-h-[460px] sm:min-h-[540px] relative overflow-hidden flex flex-col justify-between border border-slate-200/80 dark:border-white/10 shadow-xl group">
          <div
            className="absolute inset-0 opacity-[0.04] pointer-events-none"
            style={{
              backgroundImage: 'radial-gradient(circle at 2px 2px, currentColor 1.5px, transparent 0)',
              backgroundSize: '28px 28px',
            }}
          />

          <div className="relative z-10 flex items-center justify-between">
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
              {isRelatedLoading ? 'Loading connections…' : 'Real knowledge graph • Tap a node to inspect'}
            </span>
          </div>

          {isEntitiesLoading && (
            <div className="flex-1 flex items-center justify-center">
              <div className="w-8 h-8 rounded-full border-2 border-indigo-400/30 border-t-indigo-400 animate-spin" />
            </div>
          )}

          {!isEntitiesLoading && entities.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
              <span className="material-symbols-outlined text-3xl text-indigo-400/60">hub</span>
              <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm">
                Nothing in your knowledge graph yet. Capture a memory mentioning a person, project, or goal, or add one
                directly if you already know it belongs here.
              </p>
              <button
                onClick={onCreateEntity}
                className="mt-1 inline-flex items-center gap-1.5 px-4 py-2 rounded-full liquid-glass border border-indigo-500/40 text-indigo-600 dark:text-indigo-300 text-xs font-semibold hover:bg-indigo-500/10 transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                Add your first entity
              </button>
            </div>
          )}

          {!isEntitiesLoading && entities.length > 0 && (
            <div className="relative w-full h-80 sm:h-96 my-auto">
              <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
                <defs>
                  <linearGradient id="linkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#4f4ccd" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="#818cf8" stopOpacity="0.2" />
                  </linearGradient>
                </defs>
                {edges.map((edge, idx) => {
                  const from = canvasNodes.find((n) => n.id === edge.fromId);
                  const to = canvasNodes.find((n) => n.id === edge.toId);
                  if (!from || from.x === undefined || from.y === undefined) return null;
                  if (!to || to.x === undefined || to.y === undefined) return null;
                  return (
                    <line
                      key={idx}
                      x1={`${from.x}%`}
                      y1={`${from.y}%`}
                      x2={`${to.x}%`}
                      y2={`${to.y}%`}
                      stroke="url(#linkGrad)"
                      strokeWidth="1.5"
                    />
                  );
                })}
              </svg>

              {canvasNodes.map((node) => {
                if (node.x === undefined || node.y === undefined) return null;
                const isFocus = node.id === focusEntityId;
                return (
                  <div
                    key={node.id}
                    onClick={() => onSelectFocusEntity(node.id)}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-1.5 cursor-pointer transition-transform ${
                      isFocus ? 'scale-110' : 'hover:scale-105'
                    }`}
                    style={{ top: `${node.y}%`, left: `${node.x}%` }}
                  >
                    <div
                      className={`flex items-center justify-center border transition-all liquid-glass-heavy ${
                        isFocus
                          ? 'w-16 h-16 rounded-2xl border-indigo-500 dark:border-indigo-400 shadow-[0_0_30px_rgba(79,76,205,0.4)]'
                          : 'w-12 h-12 rounded-xl border-slate-300 dark:border-white/20'
                      }`}
                    >
                      <span
                        className="material-symbols-outlined text-indigo-600 dark:text-indigo-400"
                        style={{ fontSize: isFocus ? 28 : 20, color: node.color }}
                      >
                        {node.icon}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-slate-800 dark:text-white bg-white/90 dark:bg-black/60 backdrop-blur-md px-2 py-0.5 rounded-md border border-slate-200 dark:border-white/10 font-medium shadow-xs max-w-[110px] truncate">
                      {node.name}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {selectedNode && (
            <div className="relative z-10 liquid-glass rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-slate-200/80 dark:border-white/10">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-indigo-400 text-xl">{selectedNode.icon}</span>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white truncate">
                      {selectedNode.name}
                    </h4>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-400 shrink-0">
                      {selectedNode.cluster}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-[#c7c4d6] line-clamp-1 mt-0.5">
                    {selectedNode.description}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => onInspectNode(selectedNode)}
                  className="px-3.5 py-1.5 rounded-full liquid-glass border border-indigo-500/40 text-indigo-600 dark:text-indigo-300 text-xs font-semibold hover:bg-indigo-500/10 transition-all cursor-pointer shadow-sm text-center flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[16px]">search_insights</span>
                  Inspect
                </button>
                <button
                  onClick={() => onAskAboutNode(selectedNode)}
                  className="px-3.5 py-1.5 rounded-full bg-[#4f4ccd] dark:bg-[#c2c1ff] text-white dark:text-[#1c0b9f] text-xs font-semibold hover:opacity-90 transition-all cursor-pointer shadow-sm text-center"
                >
                  Ask Twin about this
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Side Column: Clusters & Entity Picker */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <div className="liquid-glass rounded-3xl p-5 border border-slate-200/80 dark:border-white/10 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Active Clusters</h3>
              <span className="material-symbols-outlined text-slate-400 text-lg">filter_list</span>
            </div>

            {clusterSummaries.length === 0 && (
              <p className="text-xs text-slate-500 font-mono">No entities recorded yet.</p>
            )}

            <div className="space-y-3">
              {clusterSummaries.map((summary) => (
                <div
                  key={summary.cluster}
                  onClick={() =>
                    setActiveClusterFilter(activeClusterFilter === summary.cluster ? 'all' : summary.cluster)
                  }
                  className={`flex items-start gap-3 p-3 rounded-2xl transition-all cursor-pointer border ${
                    activeClusterFilter === summary.cluster
                      ? 'bg-indigo-500/15 dark:bg-indigo-500/20 border-indigo-500/40'
                      : 'hover:bg-slate-100/70 dark:hover:bg-white/5 border-transparent'
                  }`}
                >
                  <div className="w-9 h-9 rounded-xl bg-indigo-500/10 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-indigo-600 dark:text-indigo-400 text-[20px]">
                      {summary.icon}
                    </span>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{summary.cluster}</h4>
                      <span className="text-[11px] font-mono text-indigo-600 dark:text-indigo-400 font-semibold">
                        {summary.count}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Entity Picker */}
          <div className="liquid-glass rounded-3xl p-5 border border-slate-200/80 dark:border-white/10 shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                {activeClusterFilter === 'all' ? 'All Entities' : activeClusterFilter} ({pickerEntities.length})
              </h3>
            </div>
            {pickerEntities.length === 0 && <p className="text-xs text-slate-500 font-mono">Nothing here yet.</p>}
            <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
              {pickerEntities.map((entity) => (
                <div
                  key={entity.id}
                  className={`w-full flex items-center gap-1 rounded-xl transition-all ${
                    entity.id === focusEntityId
                      ? 'bg-indigo-500/15 border border-indigo-500/30'
                      : 'hover:bg-slate-100/70 dark:hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <button
                    onClick={() => onSelectFocusEntity(entity.id)}
                    className={`flex-1 min-w-0 text-left px-3 py-2 text-xs font-mono truncate ${
                      entity.id === focusEntityId
                        ? 'text-indigo-600 dark:text-indigo-400'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {entity.name}
                  </button>
                  <button
                    onClick={() => onInspectNode(toGraphNode(entity))}
                    title={`Inspect ${entity.name}`}
                    className="shrink-0 w-7 h-7 mr-1 rounded-full flex items-center justify-center text-slate-400 hover:text-indigo-500 hover:bg-indigo-500/10"
                  >
                    <span className="material-symbols-outlined text-[16px]">search_insights</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
