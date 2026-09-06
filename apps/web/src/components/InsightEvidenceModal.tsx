import React, { useEffect, useState } from 'react';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import type { InsightEvidenceResponse } from '@twin/contracts';
import { insightsApi } from '../services/insightsApi';
import { toMemoryItem } from '../services/memoryMapper';
import { MemoryItem } from '../types';
import { STATUS_CLASS_LABEL, STATUS_CLASS_COLOR, confidenceLabel } from './InsightsSection';

interface InsightEvidenceModalProps {
  insightId: string | null;
  onClose: () => void;
  onSelectMemory: (mem: MemoryItem) => void;
  /** Phase 11: 'personal_model_fact' evidence rows (recurring_topic, priority_tension) hand off to the existing Personal Model FactEvidenceModal for the full memory-level drill-down, instead of duplicating that display here. */
  onSelectPersonalModelFact: (factId: string) => void;
  /** Phase 14: 'insight' evidence rows (cross_insight only) hand off to THIS SAME modal, re-pointed at the contributing insight's own id — reuses the existing component recursively instead of building a second drill-down view. */
  onSelectInsight: (insightId: string) => void;
}

const EVIDENCE_TYPE_LABEL: Record<string, string> = {
  memory: 'From a memory',
  entity: 'The subject of this insight',
  relationship: 'From a connection Twin tracked',
  personal_model_fact: 'From your Personal Model',
  insight: 'From another pattern Twin noticed',
  decision_history: 'From this decision’s recorded history',
};

/**
 * "Why did Twin notice this?" — a close structural mirror of
 * FactEvidenceModal.tsx. Every line here comes straight from stored
 * insight_evidence rows; there is no LLM call in this component or
 * the endpoint behind it. Phase 11's recurring_topic/priority_tension
 * evidence rows point at Personal Model facts rather than memories —
 * their "view full evidence" hands off to the existing
 * FactEvidenceModal instead of duplicating fact-evidence display here.
 */
export const InsightEvidenceModal: React.FC<InsightEvidenceModalProps> = ({
  insightId,
  onClose,
  onSelectMemory,
  onSelectPersonalModelFact,
  onSelectInsight,
}) => {
  const [data, setData] = useState<InsightEvidenceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!insightId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    insightsApi
      .getInsightEvidence(insightId)
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
  }, [insightId]);

  useEscapeToClose(onClose, Boolean(insightId));

  if (!insightId) return null;

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
      <div className="liquid-glass-heavy rounded-3xl w-full max-w-lg p-5 sm:p-6 border border-white/15 shadow-2xl relative overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-indigo-400 text-xl">insights</span>
            <span className="font-mono text-xs text-indigo-400 uppercase tracking-widest">Why Twin noticed this</span>
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
                className={`text-xs font-mono px-2.5 py-0.5 rounded-full border uppercase tracking-wider ${STATUS_CLASS_COLOR[data.insight.statusClass] ?? ''}`}
              >
                {STATUS_CLASS_LABEL[data.insight.statusClass] ?? data.insight.statusClass}
              </span>
              <p className="text-base font-semibold text-slate-900 dark:text-white mt-2">{data.insight.title}</p>
              <p className="text-sm text-slate-600 dark:text-[#c7c4d6] mt-1">{data.insight.description}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">
                {confidenceLabel(data.insight.confidence)} · first noticed{' '}
                {new Date(data.insight.firstObservedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ·
                last evidence{' '}
                {new Date(data.insight.lastObservedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            </div>

            <div>
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-2">Evidence ({data.evidence.length})</h3>
              {data.evidence.length === 0 && <p className="text-xs text-slate-500 font-mono">No stored evidence for this.</p>}
              <div className="space-y-2">
                {data.evidence.map((e) => (
                  <div key={e.id} className={`liquid-glass rounded-xl p-3 border border-white/10 ${e.supersededAt ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                      <span>{EVIDENCE_TYPE_LABEL[e.evidenceType] ?? e.evidenceType}</span>
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
                      <p
                        className={`text-xs italic mt-1 ${e.supersededAt ? 'text-slate-500 line-through decoration-slate-500/50' : 'text-slate-600 dark:text-[#c7c4d6]'}`}
                      >
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
                    {e.evidenceType === 'personal_model_fact' && e.personalModelFactId && (
                      <button
                        onClick={() => onSelectPersonalModelFact(e.personalModelFactId!)}
                        className="text-[11px] text-indigo-400 hover:underline mt-1.5 flex items-center gap-1"
                      >
                        <span>view full evidence</span>
                        <span className="material-symbols-outlined text-[12px]">chevron_right</span>
                      </button>
                    )}
                    {e.evidenceType === 'insight' && e.sourceInsightId && (
                      <button
                        onClick={() => onSelectInsight(e.sourceInsightId!)}
                        className="text-[11px] text-indigo-400 hover:underline mt-1.5 flex items-center gap-1"
                      >
                        <span>view full evidence</span>
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
