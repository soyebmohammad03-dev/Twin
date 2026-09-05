import React, { useEffect, useState } from 'react';
import { personalModelApi } from '../services/personalModelApi';
import { toEvolutionItem } from '../services/modelEvolution';
import type { EvolutionItem } from '../services/modelEvolution';
import { selectRecentDistinctChanges } from '../services/homeIntelligence';

/** How many recent changes Home surfaces — a curated highlight, not the full history (Profile's Model Evolution owns that, see ModelEvolutionSection.tsx). */
const HOME_RECENT_LIMIT = 4;

interface HomeIntelligenceFeedProps {
  /** Opens the existing FactEvidenceModal for a change tied to a real fact — same reuse as ModelEvolutionSection. */
  onInspectFact: (factId: string) => void;
}

/**
 * Phase 24 — "what changed recently", reusing Phase 9/23's real change
 * log (GET /twin/model/changes) and Phase 23's toEvolutionItem mapper
 * verbatim rather than re-deriving icon/label rules a second time. This
 * is the same data ModelEvolutionSection renders on Profile, just
 * truncated to the most recent few for Home's curated surface — not a
 * second change-tracking system.
 */
export const HomeIntelligenceFeed: React.FC<HomeIntelligenceFeedProps> = ({ onInspectFact }) => {
  const [items, setItems] = useState<EvolutionItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    personalModelApi
      .getChanges()
      .then((result) => {
        if (cancelled) return;
        setItems(selectRecentDistinctChanges(result.changes, HOME_RECENT_LIMIT).map(toEvolutionItem));
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load recent intelligence right now.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
          Recent Intelligence
        </h3>
      </div>

      {loading && (
        <div className="liquid-glass rounded-2xl p-4 text-xs font-mono text-slate-400 text-center">Loading…</div>
      )}

      {!loading && error && (
        <div className="liquid-glass rounded-2xl p-4 text-xs font-mono text-red-400 text-center">{error}</div>
      )}

      {!loading && !error && items && items.length === 0 && (
        <div className="liquid-glass rounded-2xl p-5 text-center">
          <p className="text-sm text-slate-600 dark:text-[#c7c4d6]">No recent intelligence yet.</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Capture something and Twin will begin connecting it.
          </p>
        </div>
      )}

      {!loading && !error && items && items.length > 0 && (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              onClick={item.factId ? () => onInspectFact(item.factId!) : undefined}
              className={`liquid-glass rounded-2xl p-3.5 flex items-start gap-3 border border-white/10 transition-all ${
                item.factId ? 'hover:border-indigo-400/40 cursor-pointer' : ''
              }`}
            >
              <div className="w-8 h-8 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-indigo-400 text-[16px]">{item.icon}</span>
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-indigo-400">{item.label}</span>
                <p className="text-sm text-slate-700 dark:text-[#c7c4d6] mt-0.5">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
