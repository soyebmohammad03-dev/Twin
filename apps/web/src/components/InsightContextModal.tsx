import React, { useEffect, useState } from 'react';
import type { InsightContextResponse, PersonalModelFactDto } from '@twin/contracts';
import { insightsApi } from '../services/insightsApi';
import { EPISTEMIC_LABEL, EPISTEMIC_COLOR } from './FactEvidenceModal';
import { TEMPORAL_BADGE } from './PersonalModelSection';

interface InsightContextModalProps {
  insightId: string | null;
  onClose: () => void;
  /** Hands off to the existing FactEvidenceModal for the next hop (fact -> its own evidence -> memories), the same recursive-reuse pattern InsightEvidenceModal already uses for personal_model_fact evidence — no duplicate detail viewer built for this. */
  onSelectFact: (factId: string) => void;
}

/**
 * Phase 16 — "how does this insight connect to what Twin already knows
 * about you?" Every fact shown here comes straight from
 * GET /insights/:id/context (see insightsService.ts's
 * getInsightPersonalModelContext); there is no LLM call in this
 * component or the endpoint behind it, and nothing is ever written
 * back. Deliberately a plain list, not a mini Personal Model editor —
 * confirm/correct/dismiss stay in Profile's PersonalModelSection; this
 * view is read-only, reached from Home, and its only action is drilling
 * further in.
 */
export const InsightContextModal: React.FC<InsightContextModalProps> = ({ insightId, onClose, onSelectFact }) => {
  const [data, setData] = useState<InsightContextResponse | null>(null);
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
      .getInsightContext(insightId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load Twin’s context for this.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [insightId]);

  if (!insightId) return null;

  const hasAnyContext = data && (data.directFacts.length > 0 || data.relatedFacts.length > 0);

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
      <div className="liquid-glass-heavy rounded-3xl w-full max-w-lg p-5 sm:p-6 border border-white/15 shadow-2xl relative overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-purple-400 text-xl">hub</span>
            <span className="font-mono text-xs text-purple-400 uppercase tracking-widest">What this connects to</span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {loading && <div className="py-10 text-center text-xs font-mono text-slate-400">Loading…</div>}
        {error && <div className="py-10 text-center text-xs font-mono text-red-400">{error}</div>}

        {data && !loading && (
          <div className="space-y-4 my-4">
            <p className="text-sm text-slate-600 dark:text-[#c7c4d6]">
              <span className="font-medium text-slate-900 dark:text-white">{data.insight.title}</span> — here's what Twin already knows
              about you that relates to this.
            </p>

            {!hasAnyContext && (
              <p className="text-xs text-slate-500 font-mono py-4 text-center">
                Twin hasn't connected this to anything in your Personal Model yet.
              </p>
            )}

            {data.directFacts.length > 0 && (
              <div>
                <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-2">Directly supports this</h3>
                <div className="space-y-2">
                  {data.directFacts.map((f) => (
                    <ContextFactRow key={f.id} fact={f} onInspect={() => onSelectFact(f.id)} />
                  ))}
                </div>
              </div>
            )}

            {data.relatedFacts.length > 0 && (
              <div>
                <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-2">Also connects to</h3>
                <div className="space-y-2">
                  {data.relatedFacts.map((f) => (
                    <ContextFactRow key={f.id} fact={f} onInspect={() => onSelectFact(f.id)} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const ContextFactRow: React.FC<{ fact: PersonalModelFactDto; onInspect: () => void }> = ({ fact, onInspect }) => {
  const temporalBadge = TEMPORAL_BADGE[fact.temporalState];

  return (
    <button
      onClick={onInspect}
      className="w-full text-left liquid-glass rounded-xl p-3 border border-white/10 hover:border-purple-500/40 transition-colors"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`text-[10px] font-mono px-2 py-0.5 rounded-full border uppercase tracking-wider ${EPISTEMIC_COLOR[fact.epistemicStatus] ?? ''}`}
        >
          {EPISTEMIC_LABEL[fact.epistemicStatus] ?? fact.epistemicStatus}
        </span>
        {temporalBadge && (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-500/10 border border-slate-500/30 text-slate-400 uppercase tracking-wider">
            {temporalBadge}
          </span>
        )}
      </div>
      <p className="text-sm text-slate-800 dark:text-white/90 mt-1.5">{fact.factText}</p>
      <div className="flex items-center gap-1.5 mt-1 text-[11px] text-indigo-400">
        <span>view evidence</span>
        <span className="material-symbols-outlined text-[12px]">chevron_right</span>
      </div>
    </button>
  );
};
