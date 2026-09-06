import React, { useEffect, useState } from 'react';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import type { DecisionDetailResponse, DecisionStatus, GroundedResponse, ListDecisionHistoryResponse, SupportLevel } from '@twin/contracts';
import { decisionsApi } from '../services/decisionsApi';
import { graphApi } from '../services/graphApi';
import { toMemoryItem } from '../services/memoryMapper';
import { ConnectEntityModal } from './ConnectEntityModal';
import { ConnectMemoryPanel } from './ConnectMemoryPanel';
import { MemoryItem } from '../types';

interface DecisionDetailModalProps {
  decisionId: string | null;
  onClose: () => void;
  onSelectMemory: (mem: MemoryItem) => void;
  /** Phase 26: opens the generic entity detail view for a related entity (person/project/goal/idea/event). */
  onOpenEntity: (entityId: string) => void;
  /** Phase 27: called after ANY mutation that changes this decision's status/outcome/evidence — lets the Decisions list (DecisionsSection) patch its own copy instead of going stale until remount. */
  onDecisionChanged?: (decision: DecisionDetailResponse['decision']) => void;
  /** Phase 27: called after a relationship changes, so Explore's graph canvas can refresh if focused on this decision. */
  onGraphChanged?: (entityId: string) => void;
}

const STATUS_LABEL: Record<DecisionStatus, string> = {
  open: 'Open (undecided)',
  decided: 'Decided',
  reversed: 'Reversed',
};

const STATUS_COLOR: Record<DecisionStatus, string> = {
  open: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  decided: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  reversed: 'text-slate-400 border-slate-500/30 bg-slate-500/10',
};

const SUPPORT_LEVEL_LABEL: Record<SupportLevel, string> = {
  directly_supported: 'Directly supported',
  partially_supported: 'Partially supported',
  inferred: 'Inferred',
  insufficient_evidence: 'Insufficient evidence',
};

const SUPPORT_LEVEL_COLOR: Record<SupportLevel, string> = {
  directly_supported: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  partially_supported: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  inferred: 'text-indigo-400 border-indigo-500/30 bg-indigo-500/10',
  insufficient_evidence: 'text-slate-400 border-slate-500/30 bg-slate-500/10',
};

function humanize(type: string): string {
  return type.replace(/_/g, ' ');
}

/**
 * Phase 25's real Decision Intelligence view — replaces the deleted,
 * fully-fabricated DecisionLogicModal (fake pros/cons and an invented
 * "algorithmic balance" percentage that was never wired to any data).
 * Everything shown here traces to real rows: the decision's own
 * status/outcome/decidedAt (apps/api/src/modules/decisions), its graph
 * relationships and supporting memories (the same
 * graph.service.getEntityDetail every other entity type uses), and a
 * deterministic known/unknown summary (decisionContext.ts — no LLM).
 * The "Why" panel is the one LLM-backed piece, and it reuses the
 * existing grounded POST /reason endpoint rather than a new reasoning
 * path — its citations are cross-checked against what's already shown
 * below rather than trusted blindly.
 */
export const DecisionDetailModal: React.FC<DecisionDetailModalProps> = ({
  decisionId,
  onClose,
  onSelectMemory,
  onOpenEntity,
  onDecisionChanged,
  onGraphChanged,
}) => {
  const [detail, setDetail] = useState<DecisionDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [outcomeDraft, setOutcomeDraft] = useState('');
  const [isEditingOutcome, setIsEditingOutcome] = useState(false);
  const [isConnectOpen, setIsConnectOpen] = useState(false);
  const [deletingRelationshipId, setDeletingRelationshipId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const [explanation, setExplanation] = useState<GroundedResponse | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  const [history, setHistory] = useState<ListDecisionHistoryResponse | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  function refresh(id: string) {
    return decisionsApi.getDetail(id).then((refreshed) => {
      setDetail(refreshed);
      onDecisionChanged?.(refreshed.decision);
      refreshHistory(id);
      return refreshed;
    });
  }

  function refreshHistory(id: string) {
    setHistoryError(null);
    return decisionsApi
      .getHistory(id)
      .then((rows) => setHistory(rows))
      .catch(() => setHistoryError('Could not load history.'));
  }

  useEffect(() => {
    if (!decisionId) {
      setDetail(null);
      setExplanation(null);
      setExplainError(null);
      setIsEditingOutcome(false);
      setConfirmingDeleteId(null);
      setHistory(null);
      setHistoryError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setExplanation(null);
    setExplainError(null);
    setIsEditingOutcome(false);
    setConfirmingDeleteId(null);
    setHistory(null);
    setHistoryError(null);
    refreshHistory(decisionId);
    decisionsApi
      .getDetail(decisionId)
      .then((result) => {
        if (!cancelled) {
          setDetail(result);
          setOutcomeDraft(result.decision.outcome ?? '');
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this decision.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [decisionId]);

  async function markDecided() {
    if (!decisionId) return;
    setSavingStatus(true);
    try {
      await decisionsApi.update(decisionId, { status: 'decided', outcome: outcomeDraft.trim() || null });
      await refresh(decisionId);
    } finally {
      setSavingStatus(false);
    }
  }

  async function markReversed() {
    if (!decisionId) return;
    setSavingStatus(true);
    try {
      await decisionsApi.update(decisionId, { status: 'reversed' });
      await refresh(decisionId);
    } finally {
      setSavingStatus(false);
    }
  }

  /** Phase 26: editing the outcome after a decision is already marked decided — explicit user input only. */
  async function saveOutcome() {
    if (!decisionId) return;
    setSavingStatus(true);
    try {
      await decisionsApi.update(decisionId, { outcome: outcomeDraft.trim() || null });
      await refresh(decisionId);
      setIsEditingOutcome(false);
    } finally {
      setSavingStatus(false);
    }
  }

  async function handleDeleteRelationship(relationshipId: string) {
    if (!decisionId) return;
    setDeletingRelationshipId(relationshipId);
    try {
      await graphApi.deleteRelationship(relationshipId);
      setConfirmingDeleteId(null);
      await refresh(decisionId);
      onGraphChanged?.(decisionId);
    } finally {
      setDeletingRelationshipId(null);
    }
  }

  async function loadExplanation() {
    if (!decisionId) return;
    setExplaining(true);
    setExplainError(null);
    try {
      const result = await decisionsApi.explain(decisionId);
      setExplanation(result);
    } catch {
      setExplainError("Couldn't generate an explanation right now.");
    } finally {
      setExplaining(false);
    }
  }

  useEscapeToClose(onClose, Boolean(decisionId));

  if (!decisionId) return null;

  const knownMemoryIds = new Set((detail?.supportingMemories ?? []).map((m) => m.id));
  const knownEntityIds = new Set([
    detail?.decision.id,
    ...(detail?.relationships ?? []).map((r) => r.connectedEntity.id),
  ]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
      <div className="liquid-glass-heavy rounded-3xl w-full max-w-xl p-5 sm:p-6 border border-white/15 shadow-2xl relative overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-indigo-400 text-xl">balance</span>
            <span className="font-mono text-xs text-indigo-400 uppercase tracking-widest">Decision</span>
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
              <span className={`text-xs font-mono px-2.5 py-0.5 rounded-full border uppercase tracking-wider ${STATUS_COLOR[detail.decision.status]}`}>
                {STATUS_LABEL[detail.decision.status]}
              </span>
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white mt-2">{detail.decision.name}</h2>
              {detail.decision.description && (
                <p className="text-sm text-slate-600 dark:text-[#c7c4d6] mt-1">{detail.decision.description}</p>
              )}
              {detail.decision.decidedAt && (
                <p className="text-xs font-mono text-slate-500 mt-1">
                  Decided {new Date(detail.decision.decidedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              )}
            </div>

            {/* Status controls — explicit user action only, never inferred */}
            {detail.decision.status === 'open' && (
              <div className="liquid-glass rounded-2xl p-4 border border-white/10 space-y-2">
                <label className="text-xs font-mono uppercase tracking-wider text-slate-400">Chosen option (optional)</label>
                <input
                  type="text"
                  value={outcomeDraft}
                  onChange={(e) => setOutcomeDraft(e.target.value)}
                  placeholder="What did you decide?"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none"
                />
                <button
                  type="button"
                  disabled={savingStatus}
                  onClick={markDecided}
                  className="px-4 py-2 rounded-full bg-[#4f4ccd] dark:bg-[#c2c1ff] text-white dark:text-[#1c0b9f] text-xs font-semibold hover:opacity-90 transition-all shadow-md active:scale-95 disabled:opacity-50"
                >
                  Mark as decided
                </button>
              </div>
            )}
            {detail.decision.status === 'decided' && (
              <div className="liquid-glass rounded-2xl p-4 border border-white/10 space-y-2">
                {!isEditingOutcome ? (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-slate-700 dark:text-slate-300">
                      {detail.decision.outcome || <span className="text-slate-500 italic">No outcome recorded yet.</span>}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setOutcomeDraft(detail.decision.outcome ?? '');
                        setIsEditingOutcome(true);
                      }}
                      className="shrink-0 text-xs font-mono text-indigo-400 hover:underline"
                    >
                      Edit
                    </button>
                  </div>
                ) : (
                  <>
                    <label className="text-xs font-mono uppercase tracking-wider text-slate-400">Outcome</label>
                    <input
                      type="text"
                      value={outcomeDraft}
                      onChange={(e) => setOutcomeDraft(e.target.value)}
                      placeholder="What did you decide?"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={savingStatus}
                        onClick={saveOutcome}
                        className="px-4 py-1.5 rounded-full bg-[#4f4ccd] dark:bg-[#c2c1ff] text-white dark:text-[#1c0b9f] text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsEditingOutcome(false)}
                        className="px-4 py-1.5 rounded-full text-xs font-mono text-slate-400 hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                )}
                <button
                  type="button"
                  disabled={savingStatus}
                  onClick={markReversed}
                  className="text-xs font-mono text-amber-400 hover:underline disabled:opacity-50"
                >
                  Reverse this decision
                </button>
              </div>
            )}

            {/* Known / Unknown — deterministic, no LLM */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <h3 className="text-xs font-mono uppercase tracking-wider text-emerald-400 mb-2">Known</h3>
                <ul className="space-y-1">
                  {detail.context.known.map((k, i) => (
                    <li key={i} className="text-xs text-slate-700 dark:text-slate-300 flex gap-1.5">
                      <span className="text-emerald-500">•</span>
                      <span>{k}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-2">Not yet recorded</h3>
                <ul className="space-y-1">
                  {detail.context.unknown.map((u, i) => (
                    <li key={i} className="text-xs text-slate-500 flex gap-1.5">
                      <span className="text-slate-600">•</span>
                      <span>{u}</span>
                    </li>
                  ))}
                  {detail.context.unknown.length === 0 && (
                    <li className="text-xs text-slate-500 font-mono">Nothing — this decision is fully recorded.</li>
                  )}
                </ul>
              </div>
            </div>

            {/* Relationships (alternatives/people/projects — whatever's actually been linked) */}
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
                <p className="text-xs text-slate-500 font-mono">No related people, projects, or alternatives recorded yet.</p>
              )}
              <div className="space-y-1.5">
                {detail.relationships.map(({ relationship, connectedEntity }) => (
                  <div key={relationship.id} className="liquid-glass rounded-xl border border-white/10 overflow-hidden">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onOpenEntity(connectedEntity.id)}
                        className="flex-1 min-w-0 text-left p-2.5 hover:bg-white/5 transition-all flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-[10px] font-mono text-slate-500 uppercase">{humanize(relationship.relationshipType)}</div>
                          <div className="text-sm text-slate-800 dark:text-white truncate">{connectedEntity.name}</div>
                        </div>
                        <span className="material-symbols-outlined text-slate-500 text-base shrink-0">chevron_right</span>
                      </button>
                      <button
                        onClick={() => setConfirmingDeleteId(confirmingDeleteId === relationship.id ? null : relationship.id)}
                        title="Remove this connection"
                        className="shrink-0 w-8 h-8 mr-1.5 rounded-full flex items-center justify-center text-slate-500 hover:text-rose-400 hover:bg-rose-500/10"
                      >
                        <span className="material-symbols-outlined text-[16px]">link_off</span>
                      </button>
                    </div>
                    {confirmingDeleteId === relationship.id && (
                      <div className="px-2.5 pb-2.5 pt-1 border-t border-white/10 flex items-center justify-between gap-2 bg-rose-500/5">
                        <p className="text-xs text-slate-400">Remove this connection?</p>
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
                  </div>
                ))}
              </div>
            </div>

            {/* Linked memories — memory_entities links, NOT automatically "supporting evidence" for any claim */}
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
                entityId={detail.decision.id}
                onLinked={() => {
                  refresh(detail.decision.id);
                }}
              />
            </div>

            {/* History — real status/outcome/decidedAt transitions, oldest first */}
            <div>
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-2">History</h3>
              {historyError && <p className="text-xs text-red-400 font-mono">{historyError}</p>}
              {!historyError && history && history.length === 0 && (
                <p className="text-xs text-slate-500 font-mono">No changes recorded yet.</p>
              )}
              {history && history.length > 0 && (
                <div className="space-y-1.5">
                  {history.map((entry) => (
                    <div key={entry.id} className="liquid-glass rounded-xl p-2.5 border border-white/10 text-xs">
                      <div className="text-[10px] font-mono text-slate-500">
                        {new Date(entry.changedAt).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </div>
                      <div className="text-slate-700 dark:text-slate-300 mt-0.5">
                        {entry.previousStatus !== entry.newStatus && (
                          <span>
                            Status: {STATUS_LABEL[entry.previousStatus]} → {STATUS_LABEL[entry.newStatus]}
                          </span>
                        )}
                        {entry.previousOutcome !== entry.newOutcome && (
                          <div>Outcome: {entry.previousOutcome || <em className="text-slate-500">none</em>} → {entry.newOutcome || <em className="text-slate-500">none</em>}</div>
                        )}
                        {entry.previousDecidedAt !== entry.newDecidedAt && (
                          <div>
                            Decided date:{' '}
                            {entry.previousDecidedAt ? new Date(entry.previousDecidedAt).toLocaleDateString() : <em className="text-slate-500">none</em>} →{' '}
                            {entry.newDecidedAt ? new Date(entry.newDecidedAt).toLocaleDateString() : <em className="text-slate-500">none</em>}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Grounded "why" explanation — reuses POST /reason, on demand */}
            <div className="pt-3 border-t border-white/10">
              {!explanation && !explaining && (
                <button
                  type="button"
                  onClick={loadExplanation}
                  className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full liquid-glass border border-indigo-400/30 text-indigo-400 text-xs font-mono hover:border-indigo-400/60 transition-all"
                >
                  <span className="material-symbols-outlined text-[16px]">neurology</span>
                  Why does Twin think this?
                </button>
              )}
              {explaining && <div className="text-center text-xs font-mono text-slate-400 py-3">Thinking…</div>}
              {explainError && <div className="text-center text-xs font-mono text-red-400 py-3">{explainError}</div>}

              {explanation && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-xs font-mono px-2.5 py-0.5 rounded-full border uppercase tracking-wider ${SUPPORT_LEVEL_COLOR[explanation.supportLevel]}`}>
                      {SUPPORT_LEVEL_LABEL[explanation.supportLevel]}
                    </span>
                    <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-slate-300">
                      Confidence {(explanation.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-[#c7c4d6]">{explanation.answer}</p>
                  {explanation.uncertaintyNote && (
                    <div className="liquid-glass rounded-2xl p-3 border border-amber-500/30 bg-amber-500/5">
                      <p className="text-xs text-slate-500 dark:text-slate-400">{explanation.uncertaintyNote}</p>
                    </div>
                  )}
                  {explanation.caveats.length > 0 && (
                    <ul className="space-y-1">
                      {explanation.caveats.map((c, i) => (
                        <li key={i} className="text-xs text-slate-500 flex gap-1.5">
                          <span className="text-slate-600">•</span>
                          <span>{c}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* Only cite what's already verifiably shown above — never trust a citation id blindly. */}
                  {explanation.citedMemoryIds.filter((id) => knownMemoryIds.has(id)).length > 0 && (
                    <p className="text-[11px] font-mono text-slate-500">
                      Grounded in {explanation.citedMemoryIds.filter((id) => knownMemoryIds.has(id)).length} of the memories shown above.
                    </p>
                  )}
                  {explanation.citedEntityIds.filter((id) => knownEntityIds.has(id)).length === 0 &&
                    explanation.citedMemoryIds.filter((id) => knownMemoryIds.has(id)).length === 0 && (
                      <p className="text-[11px] font-mono text-slate-500">No verifiable citations for this answer.</p>
                    )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <ConnectEntityModal
        isOpen={isConnectOpen}
        fromEntityId={decisionId}
        fromEntityName={detail?.decision.name ?? ''}
        onClose={() => setIsConnectOpen(false)}
        onConnected={() => {
          setIsConnectOpen(false);
          refresh(decisionId);
          onGraphChanged?.(decisionId);
        }}
      />
    </div>
  );
};
