import React, { useCallback, useEffect, useState } from 'react';
import type { InsightDto } from '@twin/contracts';
import { insightsApi } from '../services/insightsApi';
import { useApp } from '../context/AppContext';

interface InsightsSectionProps {
  onInspectInsight: (insightId: string) => void;
}

export const STATUS_CLASS_LABEL: Record<InsightDto['statusClass'], string> = {
  observed: 'Observed',
  inferred: 'Inferred',
  hypothesis: 'Possible pattern',
  tension: 'Tension',
  unresolved: 'Open question',
};

export const STATUS_CLASS_COLOR: Record<InsightDto['statusClass'], string> = {
  observed: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  inferred: 'text-indigo-400 border-indigo-500/30 bg-indigo-500/10',
  hypothesis: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  tension: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
  unresolved: 'text-slate-400 border-slate-500/30 bg-slate-500/10',
};

/** A small per-type icon so, now that there are five insight types sharing one flat list, each row is visually distinguishable at a glance without a layout redesign. 'cross_insight' (Phase 14) gets a distinct icon evoking "several things drawn together," not a fifth arbitrary shape. Exported so Home's single-insight highlight (Phase 15, HomeView.tsx) can reuse it instead of duplicating the map. */
export const INSIGHT_TYPE_ICON: Record<InsightDto['insightType'], string> = {
  neglected_goal: 'flag',
  recurring_topic: 'autorenew',
  priority_tension: 'balance',
  relationship_tension: 'hub',
  cross_insight: 'workspaces',
  decision_evolution: 'history',
  goal_target_approaching: 'event_upcoming',
};

const TEMPORAL_LABEL: Partial<Record<string, string>> = {
  emerging: 'Just noticed',
  stable: 'Long-standing',
  recurring: 'Recurring',
  fading: 'Fading',
  superseded: 'Replaced by something more recent',
};

/**
 * Confidence is a heuristic pattern-strength score, never a
 * calibrated probability — deliberately never rendered as a bare
 * percentage, only a qualitative bucket, so it can't read as false
 * precision. See apps/api/src/modules/insights/confidence.ts.
 */
export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.6) return 'Strong pattern';
  if (confidence >= 0.4) return 'Developing pattern';
  return 'Early signal';
}

/**
 * The Insight layer — neglected/unresolved goals (Phase 10), plus
 * recurring topics and priority tensions (Phase 11). Deliberately a
 * close structural mirror of PersonalModelSection: real backend data
 * only, progressive disclosure via "why?", and a dismiss action — but
 * no confirm/correct actions, since an insight isn't a fact to fix,
 * only an observation to accept or dismiss.
 */
export const InsightsSection: React.FC<InsightsSectionProps> = ({ onInspectInsight }) => {
  const { preferences } = useApp();
  const [insights, setInsights] = useState<InsightDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyInsightId, setBusyInsightId] = useState<string | null>(null);

  const load = useCallback(async (rebuildFirst: boolean) => {
    setLoading(true);
    setError(null);
    try {
      if (rebuildFirst) await insightsApi.rebuild();
      const result = await insightsApi.getInsights();
      setInsights(result.insights);
    } catch {
      setError("Couldn't load your Insights right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(preferences.autoSynthesis);
  }, [load, preferences.autoSynthesis]);

  async function handleDismiss(insightId: string) {
    setBusyInsightId(insightId);
    try {
      await insightsApi.dismissInsight(insightId);
      await load(false);
    } finally {
      setBusyInsightId(null);
    }
  }

  if (loading) {
    return (
      <section className="space-y-3">
        <SectionHeading />
        <div className="flex items-center justify-center py-10 text-xs font-mono text-slate-400">Looking for patterns…</div>
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

  const allInsights = insights ?? [];

  return (
    <section className="space-y-3">
      <SectionHeading />

      {allInsights.length === 0 && (
        <div className="liquid-glass rounded-3xl p-6 border border-slate-200/80 dark:border-white/10 text-center">
          <p className="text-sm text-slate-600 dark:text-[#c7c4d6]">Twin hasn't noticed any patterns worth flagging yet.</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            As you capture more memories, Twin will surface things like goals that have gone quiet, topics that keep coming up, and places
            where what you've said seems to pull in two directions.
          </p>
        </div>
      )}

      {allInsights.length > 0 && (
        <div className="space-y-2">
          {allInsights.map((insight) => (
            <InsightRow
              key={insight.id}
              insight={insight}
              isBusy={busyInsightId === insight.id}
              onInspect={() => onInspectInsight(insight.id)}
              onDismiss={() => handleDismiss(insight.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
};

const SectionHeading: React.FC = () => (
  <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 px-1">
    <span className="material-symbols-outlined text-indigo-500 dark:text-indigo-400 text-xl">insights</span>
    Insights
  </h3>
);

interface InsightRowProps {
  insight: InsightDto;
  isBusy: boolean;
  onInspect: () => void;
  onDismiss: () => void;
}

const InsightRow: React.FC<InsightRowProps> = ({ insight, isBusy, onInspect, onDismiss }) => {
  const temporalBadge = TEMPORAL_LABEL[insight.temporalState];

  return (
    <div className="liquid-glass rounded-2xl p-3.5 border border-white/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-slate-400 text-[15px]">{INSIGHT_TYPE_ICON[insight.insightType]}</span>
            <p className="text-sm text-slate-900 dark:text-white">{insight.title}</p>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{insight.description}</p>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded-full border uppercase tracking-wider ${STATUS_CLASS_COLOR[insight.statusClass]}`}
            >
              {STATUS_CLASS_LABEL[insight.statusClass]}
            </span>
            {temporalBadge && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-500/10 border border-slate-500/30 text-slate-400 uppercase tracking-wider">
                {temporalBadge}
              </span>
            )}
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-500/10 border border-slate-500/30 text-slate-400 uppercase tracking-wider">
              {confidenceLabel(insight.confidence)}
            </span>
            <button onClick={onInspect} className="text-[10px] font-mono text-indigo-400 hover:underline">
              why?
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onDismiss}
            disabled={isBusy}
            title="Dismiss (Twin keeps the history, just stops showing this)"
            className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:bg-white/10 disabled:opacity-40"
          >
            <span className="material-symbols-outlined text-[16px]">visibility_off</span>
          </button>
        </div>
      </div>
    </div>
  );
};
