import React, { useEffect, useState } from 'react';
import type { ContextPacket, IntentType, EpistemicTier } from '@twin/contracts';
import { contextApi } from '../services/contextApi';
import { toMemoryItem } from '../services/memoryMapper';
import type { MemoryDetailDto } from '@twin/contracts';
import { MemoryItem } from '../types';

interface ContextPreviewModalProps {
  /** The query to build context for. null closes the modal. */
  query: string | null;
  onClose: () => void;
  onSelectMemory: (mem: MemoryItem) => void;
}

/** Exported so Phase 20's ChatEvidenceModal can label the same IntentType/EpistemicTier values identically instead of duplicating this copy. */
export const INTENT_LABEL: Record<IntentType, string> = {
  factual_recall: 'Factual Recall',
  person_recall: 'About a Person',
  project_recall: 'About a Project',
  decision_recall: 'About a Decision',
  timeline_recall: 'Timeline',
  comparison: 'Comparison',
  planning_context: 'Planning',
  general_knowledge: 'General',
};

export const TIER_COLOR: Record<EpistemicTier, string> = {
  high: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  medium: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  low: 'text-slate-400 border-slate-500/30 bg-slate-500/10',
};

export const TIER_LABEL: Record<EpistemicTier, string> = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };

/**
 * Phase 8's minimal proof that query -> context -> evidence works,
 * reached from SearchModal's "View Context" affordance. Deliberately
 * NOT a full graph/debug dashboard — it shows what the Context Engine
 * assembled (intent, included memories with why they were included,
 * entities, and any flagged conflicts/truncation) without dumping raw
 * internal fields. Relationship evidence stays one click away via the
 * existing Phase 7 "Linked in Knowledge Graph" flow on each memory.
 */
export const ContextPreviewModal: React.FC<ContextPreviewModalProps> = ({ query, onClose, onSelectMemory }) => {
  const [packet, setPacket] = useState<ContextPacket | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query) {
      setPacket(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    contextApi
      .build({ query })
      .then((result) => {
        if (!cancelled) setPacket(result);
      })
      .catch(() => {
        if (!cancelled) setError('Could not build context for this query.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  if (!query) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
      <div className="liquid-glass-heavy rounded-3xl w-full max-w-lg p-5 sm:p-6 border border-white/15 shadow-2xl relative overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-indigo-400 text-xl">layers</span>
            <span className="font-mono text-xs text-indigo-400 uppercase tracking-widest">Context Preview</span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {loading && <div className="py-10 text-center text-xs font-mono text-slate-400">Assembling context…</div>}
        {error && <div className="py-10 text-center text-xs font-mono text-red-400">{error}</div>}

        {packet && !loading && (
          <div className="space-y-5 my-4">
            <div>
              <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 uppercase tracking-wider">
                {INTENT_LABEL[packet.intent]}
              </span>
              <p className="text-sm text-slate-600 dark:text-[#c7c4d6] mt-2">
                For: <span className="italic">"{packet.query}"</span>
              </p>
            </div>

            {packet.conflicts.length > 0 && (
              <div className="liquid-glass rounded-2xl p-3 border border-amber-500/30 bg-amber-500/5">
                <div className="flex items-center gap-1.5 text-amber-400 text-xs font-mono uppercase tracking-wider">
                  <span className="material-symbols-outlined text-[16px]">warning</span>
                  <span>Potentially conflicting evidence</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {packet.conflicts[0].description}
                  {packet.conflicts.length > 1 ? ` (+${packet.conflicts.length - 1} more)` : ''}
                </p>
              </div>
            )}

            {(packet.truncation.memoriesTruncated || packet.truncation.entitiesTruncated || packet.truncation.relationshipsTruncated) && (
              <p className="text-[11px] text-slate-500 font-mono">
                Showing a bounded subset — not everything potentially relevant was included (context budget).
              </p>
            )}

            {packet.entities.length > 0 && (
              <div>
                <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-2">
                  Entities ({packet.entities.length})
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {packet.entities.map((e) => (
                    <span
                      key={e.entityId}
                      className="text-[11px] font-mono px-2 py-1 rounded-full bg-white/5 border border-white/10 text-slate-300"
                      title={`${e.entityType} · ${e.matchType}`}
                    >
                      {e.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-2">
                Memories used as context ({packet.memories.length})
              </h3>
              {packet.memories.length === 0 && (
                <p className="text-xs text-slate-500 font-mono">No relevant memories were found for this query.</p>
              )}
              <div className="space-y-2">
                {packet.memories.map((m) => (
                  <div
                    key={m.memoryId}
                    onClick={() => onSelectMemory(toMemoryItem(toMinimalMemoryDetail(m, packet.entities)))}
                    className="liquid-glass rounded-2xl p-3 border border-white/10 hover:border-indigo-400/40 cursor-pointer transition-all"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${TIER_COLOR[m.epistemicTier]}`}>
                        {TIER_LABEL[m.epistemicTier]}
                      </span>
                      {m.contentTruncated && <span className="text-[10px] text-slate-500 font-mono">truncated</span>}
                    </div>
                    <p className="text-xs text-slate-700 dark:text-[#c7c4d6] line-clamp-3">{m.content}</p>
                    {m.includedBecause.length > 0 && (
                      <p className="text-[10px] text-indigo-400/80 font-mono mt-1.5 truncate">
                        why: {m.includedBecause.slice(0, 2).join(' · ')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * ContextMemoryItem is a compact projection, not a full MemoryDetailDto
 * (see packages/contracts/src/context.ts) — this adapts just enough of
 * it to reuse the existing memoryMapper.toMemoryItem/MemoryDetailModal
 * flow when a user taps a context memory, rather than building a
 * second, parallel memory-detail view. Exported so Phase 20's
 * ChatEvidenceModal (Twin Chat's "Why does Twin think this?" panel,
 * which renders the exact same ContextMemoryItem shape embedded in a
 * chat response's evidence) can reuse it instead of duplicating this
 * adapter.
 */
export function toMinimalMemoryDetail(m: ContextPacket['memories'][number], entities: ContextPacket['entities']): MemoryDetailDto {
  const entityById = new Map(entities.map((e) => [e.entityId, e]));
  const entityLinks = m.matchedEntityIds
    .map((entityId) => entityById.get(entityId))
    .filter((e): e is ContextPacket['entities'][number] => Boolean(e))
    .map((e) => ({
      id: `${m.memoryId}-${e.entityId}`,
      memoryId: m.memoryId,
      entityId: e.entityId,
      role: 'mentioned',
      createdAt: m.createdAt,
      entity: {
        id: e.entityId,
        entityType: e.entityType,
        name: e.name,
        description: null,
        metadata: {},
        archivedAt: null,
        createdAt: m.createdAt,
        updatedAt: m.createdAt,
      },
    }));

  return {
    id: m.memoryId,
    sourceId: m.sourceId,
    memoryType: m.memoryType,
    content: m.content,
    epistemicStatus: m.epistemicStatus,
    confidence: m.confidence,
    importance: m.importance,
    occurredAt: m.occurredAt,
    metadata: {},
    createdAt: m.createdAt,
    updatedAt: m.createdAt,
    source: {
      id: m.sourceId,
      sourceType: m.sourceType,
      title: null,
      rawContent: null,
      url: null,
      capturedAt: null,
      metadata: {},
      createdAt: m.createdAt,
    },
    entityLinks,
  };
}
