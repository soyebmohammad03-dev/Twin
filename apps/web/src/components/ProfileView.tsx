import React from 'react';
import type { DecisionDto } from '@twin/contracts';
import { MemoryItem } from '../types';
import { INITIAL_USER } from '../data/mockData';
import { useApp } from '../context/AppContext';
import { DigitalTwinOverview } from './DigitalTwinOverview';
import { PersonalModelSection } from './PersonalModelSection';
import { InsightsSection } from './InsightsSection';
import { IngestionActivitySection } from './IngestionActivitySection';
import { ModelEvolutionSection } from './ModelEvolutionSection';
import { DecisionsSection } from './DecisionsSection';

interface ProfileViewProps {
  onOpenPrivacy: () => void;
  onSelectTab: (tab: 'home' | 'twin' | 'memory' | 'explore' | 'profile') => void;
  /** Phase 9: opens the evidence drill-down for a Personal Model fact. Also reused by Phase 23's Model Evolution timeline. */
  onInspectFact: (factId: string) => void;
  /** Phase 10: opens the evidence drill-down for an Insight. */
  onInspectInsight: (insightId: string) => void;
  /** Phase 22: opens the real memory a piece of ingestion activity produced. */
  onSelectMemory: (mem: MemoryItem) => void;
  /** Phase 26: opens the Decision Detail view for a decision entity id. */
  onOpenDecision: (decisionId: string) => void;
  /** Phase 27: lifted to App.tsx so DecisionDetailModal's mutations can patch this same array — fixes the Phase 26 stale hasEvidence bug. */
  decisions: DecisionDto[];
  isDecisionsLoading: boolean;
  decisionsError: string | null;
  onDecisionCreated: (decision: DecisionDto) => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  onOpenPrivacy,
  onInspectFact,
  onInspectInsight,
  onSelectMemory,
  onOpenDecision,
  decisions,
  isDecisionsLoading,
  decisionsError,
  onDecisionCreated,
}) => {
  const { userProfile, resolvedTheme } = useApp();
  const isDark = resolvedTheme === 'dark';
  const activeAvatar = isDark
    ? userProfile?.avatarUrl || INITIAL_USER.avatarUrl
    : userProfile?.lightAvatarUrl || userProfile?.avatarUrl || INITIAL_USER.lightAvatarUrl;
  const activeName = userProfile?.name || INITIAL_USER.name;
  const activeEmail = userProfile?.email || INITIAL_USER.email;
  const activeHandle = userProfile?.handle || INITIAL_USER.handle;

  return (
    <div className="flex flex-col gap-6 sm:gap-8 max-w-2xl mx-auto w-full pb-36 pt-2">
      {/* Active User Identity Banner */}
      <div className="w-full liquid-glass rounded-3xl p-4 sm:p-5 border border-slate-200/80 dark:border-white/10 flex items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-indigo-500/50 shadow-md shrink-0">
            <img
              src={activeAvatar}
              alt={activeName}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white truncate">
                {activeName}
              </h2>
              <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30">
                VERIFIED
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-white/60 font-mono truncate">
              {activeEmail} • {activeHandle}
            </p>
          </div>
        </div>
        <div className="hidden sm:flex flex-col items-end text-right text-[11px] font-mono text-slate-400 dark:text-white/40 shrink-0">
          <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Zero-Telemetry Node
          </span>
          <span className="truncate max-w-[140px]">{userProfile?.role || 'Twin Architect'}</span>
        </div>
      </div>

      {/* Hero / Identity Node */}
      <section className="flex flex-col items-center justify-center text-center relative py-2">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-indigo-500/10 dark:bg-indigo-500/15 blur-[60px] rounded-full pointer-events-none" />

        <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-full border border-white/20 liquid-glass-heavy flex items-center justify-center p-4 shadow-2xl twin-core-glow group">
          <div className="absolute inset-0 rounded-full border border-indigo-400/30 animate-[spin_12s_linear_infinite]" />
          <img
            src={INITIAL_USER.twinSymbolUrl}
            alt="Twin Core"
            className="w-full h-full object-contain relative z-10 filter drop-shadow-[0_0_16px_rgba(194,193,255,0.7)] group-hover:scale-105 transition-transform duration-500"
          />
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white mt-4">
          {activeName}'s Digital Twin
        </h1>
        <p className="text-sm text-slate-600 dark:text-[#c7c4d6]/80 mt-0.5">
          An evolving, evidence-grounded model of your world — not an AI pretending to be you.
        </p>
      </section>

      {/* Phase 23: real entity counts + real Personal Model epistemic calibration — replaces the previous TwinModelProfile-mock bento grid and fixed 70/20/10 confidence bar */}
      <DigitalTwinOverview />

      {/* Phase 9: real, evidence-backed Personal Model — categories, confirm/correct/dismiss, evidence drill-down */}
      <PersonalModelSection onInspectFact={onInspectFact} />

      {/* Phase 10: evidence-backed Insights — a separate epistemic layer from the Personal Model above, dismissible, never a fact to correct */}
      <InsightsSection onInspectInsight={onInspectInsight} />

      {/* Phase 26: real Decisions home — list, create, filter by status; opens DecisionDetailModal. Phase 27: data lifted to App.tsx so it stays live-updated after mutations made from the detail modal. */}
      <DecisionsSection
        decisions={decisions}
        isLoading={isDecisionsLoading}
        error={decisionsError}
        onOpenDecision={onOpenDecision}
        onDecisionCreated={onDecisionCreated}
      />

      {/* Phase 22: real ingestion activity — replaces the previous fabricated "Active Background Threads" */}
      <IngestionActivitySection onSelectMemory={onSelectMemory} />

      {/* Phase 23: real, evidence-tied change history — replaces the previous fixed-months fake bar chart */}
      <ModelEvolutionSection onInspectFact={onInspectFact} />

      {/* Privacy Configuration Button */}
      <div className="flex justify-center pt-2">
        <button
          onClick={onOpenPrivacy}
          className="px-6 py-3 rounded-full liquid-glass border border-slate-200/80 dark:border-white/15 text-xs font-mono uppercase tracking-widest text-slate-800 dark:text-slate-200 hover:bg-slate-100/70 dark:hover:bg-white/10 transition-all flex items-center gap-2 active:scale-95 cursor-pointer shadow-md"
        >
          <span className="material-symbols-outlined text-[18px] text-indigo-500 dark:text-indigo-400">
            shield_lock
          </span>
          <span>Privacy &amp; Memory Settings</span>
        </button>
      </div>
    </div>
  );
};
