import React, { useEffect, useState } from 'react';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import type { EntityDetailResponse, RelationshipEvidenceResponse } from '@twin/contracts';
import { graphApi } from '../services/graphApi';
import { toMemoryItem } from '../services/memoryMapper';
import { ConnectEntityModal } from './ConnectEntityModal';
import { ConnectMemoryPanel } from './ConnectMemoryPanel';
import { MemoryItem } from '../types';

interface EntityDetailModalProps {
  entityId: string | null;
  onClose: () => void;
  onSelectMemory: (mem: MemoryItem) => void;
  /** Phase 25: only called for entityType === 'decision' — opens the dedicated DecisionDetailModal with status/outcome/evidence. */
  onOpenDecision: (entityId: string) => void;
  /** Phase 27: called after a relationship is created/removed here, so the Knowledge Graph canvas can refresh its own traversal if this entity is (or was) the one it's focused on. */
  onGraphChanged?: (entityId: string) => void;
}

const EPISTEMIC_LABEL: Record<string, string> = {
  explicit: 'Explicit',
  from_source: 'From source',
  reported_by_other: 'Reported by someone else',
  inferred: 'Inferred',
  probable: 'Uncertain',
};

const EPISTEMIC_COLOR: Record<string, string> = {
  explicit: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  from_source: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  reported_by_other: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  inferred: 'text-indigo-400 border-indigo-500/30 bg-indigo-500/10',
  probable: 'text-slate-400 border-slate-500/30 bg-slate-500/10',
};

function humanizeRelationshipType(type: string): string {
  return type.replace(/_/g, ' ');
}

/**
 * Phase 7's minimal, style-consistent way to inspect the knowledge
 * graph: entity → relationships → connected entities → linked
 * memories, with evidence available progressively (a "Why?" toggle per
 * relationship) rather than dumped on screen by default. Phase 27 adds
 * the ability to actually create and remove connections here, not just
 * view AI-extracted ones.
 */
export const EntityDetailModal: React.FC<EntityDetailModalProps> = ({ entityId, onClose, onSelectMemory, onOpenDecision, onGraphChanged }) => {
  const [detail, setDetail] = useState<EntityDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRelationshipId, setExpandedRelationshipId] = useState<string | null>(null);
  const [evidenceByRelationship, setEvidenceByRelationship] = useState<Record<string, RelationshipEvidenceResponse>>({});
  const [evidenceLoading, setEvidenceLoading] = useState<string | null>(null);
  const [isConnectOpen, setIsConnectOpen] = useState(false);
  const [deletingRelationshipId, setDeletingRelationshipId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  function load(id: string) {
    let cancelled = false;
    setLoading(true);
    setError(null);
    graphApi
      .getEntityDetail(id)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this entity.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }

  useEffect(() => {
    if (!entityId) {
      setDetail(null);
      return;
    }
    setExpandedRelationshipId(null);
    setConfirmingDeleteId(null);
    return load(entityId);
  }, [entityId]);

  async function toggleEvidence(relationshipId: string) {
    if (expandedRelationshipId === relationshipId) {
      setExpandedRelationshipId(null);
      return;
    }
    setExpandedRelationshipId(relationshipId);
    if (!evidenceByRelationship[relationshipId]) {
      setEvidenceLoading(relationshipId);
      try {
        const result = await graphApi.getRelationshipEvidence(relationshipId);
        setEvidenceByRelationship((prev) => ({ ...prev, [relationshipId]: result }));
      } catch {
        // Evidence panel simply stays empty on failure — the relationship itself is still shown.
      } finally {
        setEvidenceLoading(null);
      }
    }
  }

  async function handleDeleteRelationship(relationshipId: string) {
    if (!entityId) return;
    setDeletingRelationshipId(relationshipId);
    try {
      await graphApi.deleteRelationship(relationshipId);
      setConfirmingDeleteId(null);
      load(entityId);
      onGraphChanged?.(entityId);
    } finally {
      setDeletingRelationshipId(null);
    }
  }

  useEscapeToClose(onClose, Boolean(entityId));

  if (!entityId) return null;

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
      <div className="liquid-glass-heavy rounded-3xl w-full max-w-lg p-5 sm:p-6 border border-white/15 shadow-2xl relative overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-indigo-400 text-xl">hub</span>
            <span className="font-mono text-xs text-indigo-400 uppercase tracking-widest">Knowledge Graph</span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {loading && <div className="py-10 text-center text-xs font-mono text-slate-400">Loading…</div>}
        {error && <div className="py-10 text-center text-xs font-mono text-red-400">{error}</div>}

        {detail && !loading && (
          <div className="space-y-5 my-4">
            <div>
              <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 uppercase tracking-wider">
                {detail.entity.entityType}
              </span>
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white mt-2">{detail.entity.name}</h2>
              {detail.entity.description && (
                <p className="text-sm text-slate-600 dark:text-[#c7c4d6] mt-1">{detail.entity.description}</p>
              )}
              {detail.entity.entityType === 'decision' && (
                <button
                  type="button"
                  onClick={() => onOpenDecision(detail.entity.id)}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full liquid-glass border border-indigo-400/30 text-indigo-400 text-xs font-mono hover:border-indigo-400/60 transition-all"
                >
                  <span className="material-symbols-outlined text-[16px]">balance</span>
                  View decision status &amp; evidence
                </button>
              )}

              {/* Phase 40: the entity's real subtype data — status/dates Twin actually recorded, never invented. */}
              {detail.subtype && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {detail.subtype.kind === 'project' && (
                    <>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-500/10 border border-slate-500/30 text-slate-400 uppercase tracking-wider">
                        {detail.subtype.status}
                      </span>
                      {detail.subtype.startedAt && (
                        <span className="text-[10px] font-mono text-slate-500">
                          started {new Date(detail.subtype.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      )}
                      {detail.subtype.completedAt && (
                        <span className="text-[10px] font-mono text-slate-500">
                          completed {new Date(detail.subtype.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      )}
                    </>
                  )}
                  {detail.subtype.kind === 'goal' && (
                    <>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-500/10 border border-slate-500/30 text-slate-400 uppercase tracking-wider">
                        {detail.subtype.status}
                      </span>
                      {detail.subtype.targetDate && (
                        <span className="text-[10px] font-mono text-slate-500">
                          target {new Date(detail.subtype.targetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      )}
                      {detail.subtype.achievedAt && (
                        <span className="text-[10px] font-mono text-slate-500">
                          achieved {new Date(detail.subtype.achievedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      )}
                    </>
                  )}
                  {detail.subtype.kind === 'event' && (
                    <>
                      <span className="text-[10px] font-mono text-slate-500">
                        {new Date(detail.subtype.startsAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        {detail.subtype.endsAt &&
                          ` – ${new Date(detail.subtype.endsAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
                      </span>
                      {detail.subtype.location && <span className="text-[10px] font-mono text-slate-500">· {detail.subtype.location}</span>}
                    </>
                  )}
                  {detail.subtype.kind === 'person' && (detail.subtype.role || detail.subtype.relationship) && (
                    <span className="text-[10px] font-mono text-slate-500">
                      {[detail.subtype.role, detail.subtype.relationship].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Relationships */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400">
                  Connections ({detail.relationships.length})
                </h3>
                <button
                  type="button"
                  onClick={() => setIsConnectOpen(true)}
                  className="flex items-center gap-1 text-xs font-mono text-indigo-400 hover:underline"
                >
                  <span className="material-symbols-outlined text-[14px]">add_link</span>
                  Connect
                </button>
              </div>
              {detail.relationships.length === 0 && (
                <p className="text-xs text-slate-500 font-mono">No connections recorded yet.</p>
              )}
              <div className="space-y-2">
                {detail.relationships.map(({ relationship, connectedEntity, direction }) => (
                  <div key={relationship.id} className="liquid-glass rounded-2xl border border-white/10 overflow-hidden">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => toggleEvidence(relationship.id)}
                        className="flex-1 min-w-0 flex items-center justify-between gap-2 p-3 text-left hover:bg-white/5 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                            {direction === 'outgoing' ? humanizeRelationshipType(relationship.relationshipType) : `${humanizeRelationshipType(relationship.relationshipType)} (by)`}
                          </div>
                          <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                            {connectedEntity.name}
                          </div>
                        </div>
                        <span
                          className={`shrink-0 text-[10px] font-mono px-2 py-0.5 rounded-full border ${EPISTEMIC_COLOR[relationship.epistemicStatus] ?? ''}`}
                        >
                          {EPISTEMIC_LABEL[relationship.epistemicStatus] ?? relationship.epistemicStatus}
                        </span>
                        <span className="material-symbols-outlined text-slate-500 text-base shrink-0">
                          {expandedRelationshipId === relationship.id ? 'expand_less' : 'expand_more'}
                        </span>
                      </button>
                      <button
                        onClick={() => setConfirmingDeleteId(confirmingDeleteId === relationship.id ? null : relationship.id)}
                        title="Remove this connection"
                        className="shrink-0 w-8 h-8 mr-2 rounded-full flex items-center justify-center text-slate-500 hover:text-rose-400 hover:bg-rose-500/10"
                      >
                        <span className="material-symbols-outlined text-[16px]">link_off</span>
                      </button>
                    </div>

                    {confirmingDeleteId === relationship.id && (
                      <div className="px-3 pb-3 pt-1 border-t border-white/10 flex items-center justify-between gap-2 bg-rose-500/5">
                        <p className="text-xs text-slate-400">Remove this connection? This won't delete either entity or any memory.</p>
                        <div className="flex gap-2 shrink-0">
                          <button
                            disabled={deletingRelationshipId === relationship.id}
                            onClick={() => handleDeleteRelationship(relationship.id)}
                            className="text-xs font-mono px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 disabled:opacity-50"
                          >
                            {deletingRelationshipId === relationship.id ? 'Removing…' : 'Remove'}
                          </button>
                          <button onClick={() => setConfirmingDeleteId(null)} className="text-xs font-mono text-slate-400 hover:text-white">
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {expandedRelationshipId === relationship.id && (
                      <div className="px-3 pb-3 pt-1 border-t border-white/10 text-xs space-y-2">
                        {evidenceLoading === relationship.id && (
                          <div className="text-slate-500 font-mono">Loading evidence…</div>
                        )}
                        {evidenceByRelationship[relationship.id]?.evidence.map((e) => (
                          <div key={e.id} className="liquid-glass rounded-xl p-2.5 border border-white/5">
                            {e.evidenceText && (
                              <p className="text-slate-600 dark:text-[#c7c4d6] italic">“{e.evidenceText}”</p>
                            )}
                            <div className="flex items-center gap-2 mt-1.5 font-mono text-[10px] text-slate-400">
                              <span>Confidence {(e.confidence * 100).toFixed(0)}%</span>
                              <span>•</span>
                              <span>{e.extractionMethod}</span>
                              {e.memory && (
                                <>
                                  <span>•</span>
                                  <button
                                    onClick={() => e.memory && onSelectMemory(toMemoryItem(e.memory))}
                                    className="text-indigo-400 hover:underline"
                                  >
                                    view memory
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                        {evidenceByRelationship[relationship.id]?.evidence.length === 0 && (
                          <div className="text-slate-500 font-mono">
                            {relationship.extractionMethod === 'user-declared'
                              ? 'You declared this connection directly — no memory evidence is attached.'
                              : 'No stored evidence for this connection.'}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Linked memories — memory_entities links, NOT the same thing as relationship evidence above */}
            <div>
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-2">
                Linked Memories ({detail.supportingMemories.length})
              </h3>
              {detail.supportingMemories.length === 0 && (
                <p className="text-xs text-slate-500 font-mono">No memories linked yet.</p>
              )}
              <div className="space-y-2">
                {detail.supportingMemories.map((memory) => (
                  <div
                    key={memory.id}
                    onClick={() => onSelectMemory(toMemoryItem(memory))}
                    className="liquid-glass rounded-2xl p-3 border border-white/10 hover:border-indigo-400/40 cursor-pointer transition-all"
                  >
                    <p className="text-xs text-slate-700 dark:text-[#c7c4d6] line-clamp-2">{memory.content}</p>
                  </div>
                ))}
              </div>
              <ConnectMemoryPanel
                entityId={detail.entity.id}
                onLinked={() => {
                  load(detail.entity.id);
                }}
              />
            </div>
          </div>
        )}
      </div>

      <ConnectEntityModal
        isOpen={isConnectOpen}
        fromEntityId={entityId}
        fromEntityName={detail?.entity.name ?? ''}
        onClose={() => setIsConnectOpen(false)}
        onConnected={() => {
          setIsConnectOpen(false);
          load(entityId);
          onGraphChanged?.(entityId);
        }}
      />
    </div>
  );
};
