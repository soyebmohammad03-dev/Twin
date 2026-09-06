import React, { useEffect, useState } from 'react';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import type { FactEvidenceResponse } from '@twin/contracts';
import { personalModelApi } from '../services/personalModelApi';
import { toMemoryItem } from '../services/memoryMapper';
import { MemoryItem } from '../types';

interface FactEvidenceModalProps {
  factId: string | null;
  onClose: () => void;
  onSelectMemory: (mem: MemoryItem) => void;
}

/** Exported so Phase 16's InsightContextModal can render a Personal Model fact's epistemic status identically to this modal, instead of duplicating the copy. */
export const EPISTEMIC_LABEL: Record<string, string> = {
  explicit: 'You told Twin directly',
  from_source: 'From a source you provided',
  reported_by_other: 'Reported by someone else',
  inferred: 'Twin inferred this',
  probable: 'Twin suspects this, not confident',
};

export const EPISTEMIC_COLOR: Record<string, string> = {
  explicit: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  from_source: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  reported_by_other: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  inferred: 'text-indigo-400 border-indigo-500/30 bg-indigo-500/10',
  probable: 'text-slate-400 border-slate-500/30 bg-slate-500/10',
};

const SOURCE_LABEL: Record<string, string> = {
  memory: 'From a memory',
  relationship: 'From a connection Twin tracked',
  user_confirmation: 'You confirmed this',
  user_correction: 'You corrected this',
  user_dismissal: 'You dismissed this',
};

/**
 * Phase 9's "why does Twin think this?" — item 13. Every line here
 * comes straight from stored personal_model_fact_evidence rows; there
 * is no LLM call in this component or the endpoint behind it.
 */
export const FactEvidenceModal: React.FC<FactEvidenceModalProps> = ({ factId, onClose, onSelectMemory }) => {
  const [data, setData] = useState<FactEvidenceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!factId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    personalModelApi
      .getFactEvidence(factId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the evidence for this.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [factId]);

  useEscapeToClose(onClose, Boolean(factId));

  if (!factId) return null;

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
      <div className="liquid-glass-heavy rounded-3xl w-full max-w-lg p-5 sm:p-6 border border-white/15 shadow-2xl relative overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-indigo-400 text-xl">fact_check</span>
            <span className="font-mono text-xs text-indigo-400 uppercase tracking-widest">Why Twin thinks this</span>
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

        {data && !loading && (
          <div className="space-y-4 my-4">
            <div>
              <span
                className={`text-xs font-mono px-2.5 py-0.5 rounded-full border uppercase tracking-wider ${EPISTEMIC_COLOR[data.fact.epistemicStatus] ?? ''}`}
              >
                {EPISTEMIC_LABEL[data.fact.epistemicStatus] ?? data.fact.epistemicStatus}
              </span>
              <p className="text-base font-semibold text-slate-900 dark:text-white mt-2">{data.fact.factText}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">
                Confidence {(data.fact.confidence * 100).toFixed(0)}% · first noticed{' '}
                {new Date(data.fact.firstObservedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ·
                last seen {new Date(data.fact.lastObservedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            </div>

            <div>
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-2">Evidence ({data.evidence.length})</h3>
              {data.evidence.length === 0 && <p className="text-xs text-slate-500 font-mono">No stored evidence for this.</p>}
              <div className="space-y-2">
                {data.evidence.map((e) => (
                  <div key={e.id} className={`liquid-glass rounded-xl p-3 border border-white/10 ${e.supersededAt ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                      <span>{SOURCE_LABEL[e.evidenceSource] ?? e.evidenceSource}</span>
                      <span>·</span>
                      <span>{new Date(e.observedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                      {e.supersededAt && (
                        <>
                          <span>·</span>
                          <span className="text-amber-400 normal-case">superseded — kept for history</span>
                        </>
                      )}
                    </div>
                    {e.evidenceText && (
                      <p className={`text-xs italic mt-1 ${e.supersededAt ? 'text-slate-500 line-through decoration-slate-500/50' : 'text-slate-600 dark:text-[#c7c4d6]'}`}>
                        “{e.evidenceText}”
                      </p>
                    )}
                    {e.memory && (
                      <button
                        onClick={() => e.memory && onSelectMemory(toMemoryItem(e.memory))}
                        className="text-[11px] text-indigo-400 hover:underline mt-1.5 flex items-center gap-1"
                      >
                        <span>view memory</span>
                        <span className="material-symbols-outlined text-[12px]">chevron_right</span>
                      </button>
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
