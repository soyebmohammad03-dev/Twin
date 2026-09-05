import React, { useCallback, useEffect, useState } from 'react';
import type { EntityDto, PersonalModelResponse } from '@twin/contracts';
import { entityApi } from '../services/memoryApi';
import { personalModelApi } from '../services/personalModelApi';
import { countEntities, computeEpistemicBreakdown } from '../services/personalModelStats';

function formatRelativeDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Phase 23 — replaces ProfileView's previous "What Twin Knows" bento
 * grid and "Model Calibration" bar, both of which were driven entirely
 * by TwinModelProfile mock data (hardcoded counts, fixed 70/20/10
 * percentages, fabricated status words like "Deep"/"Evolving").
 *
 * Reuses exactly the data other real sections already fetch: entities
 * (GET /entities — the same call ExploreView's Phase 21 wiring uses)
 * and the Personal Model (GET /twin/model — the same shape
 * PersonalModelSection already renders in full detail below this).
 * This component deliberately does NOT trigger a rebuild itself —
 * PersonalModelSection's own mount effect already does the one
 * explicit rebuild this page needs (see item 24's "never rebuild on
 * every page load"); this just reads whatever is current, exactly like
 * InsightsSection and IngestionActivitySection already do independently
 * on the same screen.
 */
export const DigitalTwinOverview: React.FC = () => {
  const [entities, setEntities] = useState<EntityDto[] | null>(null);
  const [model, setModel] = useState<PersonalModelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [entityRows, modelResult] = await Promise.all([entityApi.list(), personalModelApi.getModel()]);
      setEntities(entityRows);
      setModel(modelResult);
    } catch {
      setError("Couldn't load what Twin knows right now.");
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

  const counts = countEntities(entities ?? []);
  const breakdown = model ? computeEpistemicBreakdown(model.facts, model.uncertainFactIds) : null;

  return (
    <section className="space-y-3">
      <SectionHeading />

      {model?.snapshotVersion != null && (
        <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 px-1">
          Model v{model.snapshotVersion} · last updated {formatRelativeDate(model.generatedAt)}
        </p>
      )}

      {counts.total === 0 ? (
        <div className="liquid-glass rounded-3xl p-6 border border-slate-200/80 dark:border-white/10 text-center">
          <p className="text-sm text-slate-600 dark:text-[#c7c4d6]">Nothing in your knowledge graph yet.</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Capture a memory mentioning a person, project, or goal and Twin will start tracking it here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3.5">
          <div className="col-span-2 rounded-3xl liquid-glass p-5 sm:p-6 border border-slate-200/80 dark:border-white/10 relative overflow-hidden group">
            <div className="specular-highlight absolute inset-0 pointer-events-none opacity-20 rounded-3xl" />
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Knowledge Base
              </span>
              <span className="material-symbols-outlined text-indigo-500 dark:text-indigo-400 text-[20px]">memory</span>
            </div>
            <div className="flex items-baseline gap-2.5 mt-3">
              <span className="text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white">{counts.total}</span>
              <span className="text-sm text-slate-500 dark:text-slate-400">discrete interconnected entities</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              People, projects, goals, decisions, and ideas Twin has recorded from your memories.
            </p>
          </div>

          <div className="col-span-1 rounded-2xl liquid-glass p-4 sm:p-5 border border-slate-200/80 dark:border-white/10 flex flex-col justify-between">
            <div className="flex items-center justify-between text-indigo-500 dark:text-indigo-400">
              <span className="font-mono text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">People</span>
              <span className="material-symbols-outlined text-[18px]">group</span>
            </div>
            <div className="mt-3">
              <span className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">{counts.people}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400 block mt-0.5">recorded</span>
            </div>
          </div>

          <div className="col-span-1 rounded-2xl liquid-glass p-4 sm:p-5 border border-slate-200/80 dark:border-white/10 flex flex-col justify-between">
            <div className="flex items-center justify-between text-amber-500 dark:text-amber-400">
              <span className="font-mono text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">Goals</span>
              <span className="material-symbols-outlined text-[18px]">flag</span>
            </div>
            <div className="mt-3">
              <span className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">{counts.goals}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400 block mt-0.5">tracked</span>
            </div>
          </div>
        </div>
      )}

      <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 px-1 pt-2">
        <span className="material-symbols-outlined text-indigo-500 dark:text-indigo-400 text-xl">analytics</span>
        Model Calibration
      </h3>

      {!breakdown || breakdown.totalCount === 0 ? (
        <div className="liquid-glass rounded-3xl p-6 border border-slate-200/80 dark:border-white/10 text-center">
          <p className="text-sm text-slate-600 dark:text-[#c7c4d6]">Nothing to calibrate yet.</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Once Twin has built your Personal Model below, this will show how much of it is directly stated versus
            inferred.
          </p>
        </div>
      ) : (
        <div className="liquid-glass rounded-3xl p-5 sm:p-6 border border-slate-200/80 dark:border-white/10 space-y-4">
          <div className="flex items-center justify-between text-xs font-mono text-slate-500 dark:text-slate-400">
            <span>Personal Model Confidence Distribution</span>
            <span>{breakdown.totalCount} facts</span>
          </div>

          <div className="h-4 w-full bg-slate-200 dark:bg-white/10 rounded-full flex overflow-hidden p-0.5 shadow-inner">
            <div
              className="h-full bg-indigo-600 dark:bg-[#c2c1ff] rounded-l-full transition-all duration-700"
              style={{ width: `${breakdown.explicitPct}%` }}
              title="Explicit / from a source"
            />
            <div
              className="h-full bg-violet-400 opacity-80 transition-all duration-700"
              style={{ width: `${breakdown.inferredPct}%` }}
              title="Inferred by Twin"
            />
            <div
              className="h-full bg-amber-400 opacity-80 transition-all duration-700"
              style={{ width: `${breakdown.uncertainPct}%` }}
              title="Needs confirmation"
            />
          </div>

          <div className="grid grid-cols-3 gap-2 pt-1 text-xs font-mono">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#4f4ccd] dark:bg-[#c2c1ff]" />
                <span className="text-slate-800 dark:text-white font-medium">Explicit</span>
              </div>
              <span className="text-slate-500 pl-4">
                {breakdown.explicitPct}% ({breakdown.explicitCount})
              </span>
            </div>

            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-violet-400 opacity-80" />
                <span className="text-slate-800 dark:text-white font-medium">Inferred</span>
              </div>
              <span className="text-slate-500 pl-4">
                {breakdown.inferredPct}% ({breakdown.inferredCount})
              </span>
            </div>

            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-amber-400 opacity-80" />
                <span className="text-slate-800 dark:text-white font-medium">Uncertain</span>
              </div>
              <span className="text-slate-500 pl-4">
                {breakdown.uncertainPct}% ({breakdown.uncertainCount})
              </span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

const SectionHeading: React.FC = () => (
  <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 px-1">
    <span className="material-symbols-outlined text-indigo-500 dark:text-indigo-400 text-xl">database</span>
    What Twin Knows
  </h3>
);
