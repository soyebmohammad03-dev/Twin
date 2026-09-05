import React, { useCallback, useEffect, useState } from 'react';
import { personalModelApi } from '../services/personalModelApi';
import { groupEvolutionByDay } from '../services/modelEvolution';
import type { EvolutionGroup } from '../services/modelEvolution';

interface ModelEvolutionSectionProps {
  /** Opens the existing evidence drill-down (FactEvidenceModal) for a change tied to a real fact — reused, not duplicated. */
  onInspectFact: (factId: string) => void;
}

/**
 * Phase 23 — replaces ProfileView's previous "Knowledge Evolution" bar
 * chart, which plotted six fixed months (May…Now) with hand-picked bar
 * heights that had no data behind them at all.
 *
 * The backend has generated a real, evidence-tied change log since
 * Phase 9's rebuild engine (personal_model_changes — see
 * personalModelStore.ts/personalModelService.ts) and exposed it via
 * GET /twin/model/changes since the same phase; this is simply the
 * first time the frontend renders it. Every entry shown here is a real
 * row: a fact appearing, strengthening, weakening, or being corrected/
 * dismissed by the user. Nothing here is fabricated or interpolated —
 * an empty history renders an honest empty state, never invented bars.
 */
export const ModelEvolutionSection: React.FC<ModelEvolutionSectionProps> = ({ onInspectFact }) => {
  const [groups, setGroups] = useState<EvolutionGroup[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await personalModelApi.getChanges();
      setGroups(groupEvolutionByDay(result.changes));
    } catch {
      setError("Couldn't load your model's history right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <section className="space-y-3">
        <SectionHeading />
        <div className="flex items-center justify-center py-10 text-xs font-mono text-slate-400">Loading…</div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="space-y-3">
        <SectionHeading />
        <p className="text-xs font-mono text-red-400 text-center py-6">{error}</p>
      </section>
    );
  }

  const allGroups = groups ?? [];

  return (
    <section className="space-y-3">
      <SectionHeading />

      {allGroups.length === 0 && (
        <div className="liquid-glass rounded-3xl p-6 border border-slate-200/80 dark:border-white/10 text-center">
          <p className="text-sm text-slate-600 dark:text-[#c7c4d6]">Twin needs more observations over time.</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            As your Personal Model is rebuilt from new memories, changes — new facts, strengthened patterns,
            corrections — will show up here.
          </p>
        </div>
      )}

      {allGroups.length > 0 && (
        <div className="space-y-4">
          {allGroups.map((group) => (
            <div key={group.dateLabel} className="space-y-2">
              <h4 className="text-xs font-mono uppercase tracking-wider text-slate-400 px-1">{group.dateLabel}</h4>
              <div className="space-y-2">
                {group.items.map((item) => (
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
                      <span className="text-[10px] font-mono uppercase tracking-wider text-indigo-400">
                        {item.label}
                      </span>
                      <p className="text-sm text-slate-700 dark:text-[#c7c4d6] mt-0.5">{item.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

const SectionHeading: React.FC = () => (
  <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 px-1">
    <span className="material-symbols-outlined text-indigo-500 dark:text-indigo-400 text-xl">trending_up</span>
    Model Evolution
  </h3>
);
