import React, { useState } from 'react';
import type { InsightDto } from '@twin/contracts';
import { MemoryItem, TabType } from '../types';
import { STATUS_CLASS_LABEL, STATUS_CLASS_COLOR, confidenceLabel, INSIGHT_TYPE_ICON } from './InsightsSection';
import { HomeFocusCard } from './HomeFocusCard';
import { HomeIntelligenceFeed } from './HomeIntelligenceFeed';
import { useApp } from '../context/AppContext';
import { INITIAL_USER } from '../data/mockData';
import { selectContinuationMemory, timeOfDay } from '../services/homeIntelligence';

interface HomeViewProps {
  onSelectTab: (tab: TabType) => void;
  onAskTwin: (query: string) => void;
  memories: MemoryItem[];
  onSelectMemory: (mem: MemoryItem) => void;
  /** Opens the real Capture flow (Phase 22's ingestion pipeline) — the same modal TopAppBar's capture button already opens. */
  onOpenCapture: () => void;
  /** Opens the existing FactEvidenceModal for a Personal Model fact — reused by HomeFocusCard and HomeIntelligenceFeed. */
  onInspectFact: (factId: string) => void;
  /** Phase 15: the one real, evidence-backed insight Home highlights — see services/homeInsight.ts. Null while loading or when Twin has nothing worth surfacing yet. */
  topInsight: InsightDto | null;
  onInspectTopInsight: () => void;
  onDismissTopInsight: () => void;
  /** Phase 16: opens the Context view — how topInsight connects to the user's Personal Model. */
  onOpenTopInsightContext: () => void;
}

const GREETING_WORD: Record<ReturnType<typeof timeOfDay>, string> = {
  morning: 'morning',
  afternoon: 'afternoon',
  evening: 'evening',
};

export const HomeView: React.FC<HomeViewProps> = ({
  onSelectTab,
  onAskTwin,
  memories,
  onSelectMemory,
  onOpenCapture,
  onInspectFact,
  topInsight,
  onInspectTopInsight,
  onDismissTopInsight,
  onOpenTopInsightContext,
}) => {
  const { userProfile } = useApp();
  const [quickInput, setQuickInput] = useState('');
  const activeName = userProfile?.displayName || INITIAL_USER.displayName;
  const continuationMemory = selectContinuationMemory(memories);

  const handleQuickSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickInput.trim()) return;
    onAskTwin(quickInput.trim());
    setQuickInput('');
  };

  return (
    <div className="flex flex-col gap-6 sm:gap-8 pb-32 pt-2 sm:pt-4 max-w-3xl mx-auto w-full">
      {/* Ambient Frosted Cosmic Glows */}
      <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden">
        <div className="absolute top-10 left-1/4 w-[450px] h-[450px] bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute top-72 right-12 w-[380px] h-[380px] bg-purple-600/10 rounded-full blur-[120px] pointer-events-none" />
      </div>

      {/* Main Frosted Glass Hero Container */}
      <section className="liquid-glass rounded-[2rem] sm:rounded-[2.5rem] p-6 sm:p-8 flex flex-col shadow-2xl relative overflow-hidden group">
        {/* Model Active Status Badge in Top Corner */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981] animate-pulse" />
            <span className="font-mono text-xs uppercase tracking-widest text-slate-500 dark:text-white/50">
              Neural Memory Synchronized
            </span>
          </div>
          <div className="text-[10px] bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 px-2.5 py-1 rounded-md border border-indigo-200 dark:border-indigo-500/30 uppercase tracking-widest font-bold shadow-xs">
            Model Active
          </div>
        </div>

        {/* Central Frosted Core Emblem */}
        <div className="flex flex-col items-center text-center my-2 sm:my-4">
          <div className="w-20 h-20 sm:w-24 sm:h-24 bg-gradient-to-br from-indigo-500 via-purple-600 to-pink-600 rounded-full mx-auto mb-5 blur-[1px] opacity-90 flex items-center justify-center p-1 shadow-[0_0_25px_rgba(99,102,241,0.4)]">
            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-white dark:bg-[#050505] rounded-full flex items-center justify-center border border-slate-200 dark:border-white/20">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full border-b-2 border-indigo-500 dark:border-indigo-400 flex items-center justify-center">
                <div className="w-3.5 h-3.5 rounded-full bg-indigo-500 dark:bg-indigo-400 animate-pulse shadow-[0_0_12px_#6366f1]" />
              </div>
            </div>
          </div>

          <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-slate-900 dark:text-white mb-2">
            Good {GREETING_WORD[timeOfDay()]},{' '}
            <span className="font-semibold text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 dark:from-indigo-300 dark:via-purple-300 dark:to-pink-300">
              {activeName}
            </span>
            .
          </h1>
          <p className="text-sm sm:text-base text-slate-600 dark:text-white/60 font-light max-w-xl leading-relaxed">
            {memories.length === 0
              ? "Nothing captured yet. Tell Twin what's on your mind and it will start building your picture."
              : `${memories.length} thing${memories.length === 1 ? '' : 's'} in your vault. Ask Twin anything, or see what's changed below.`}
          </p>
        </div>

        {/* Central Frosted Input Bar */}
        <form
          onSubmit={handleQuickSubmit}
          className="mt-2 flex items-center gap-2 sm:gap-3 bg-slate-100/90 dark:bg-white/10 border border-slate-200 dark:border-white/10 p-2 sm:p-2.5 rounded-full shadow-xs backdrop-blur-xl focus-within:ring-2 focus-within:ring-indigo-500/50 transition-all"
        >
          {/* Capture Button — opens the real Capture flow (Phase 22 ingestion pipeline), the same one TopAppBar's capture icon opens. */}
          <button
            type="button"
            onClick={onOpenCapture}
            className="w-10 h-10 flex items-center justify-center rounded-full transition-all shrink-0 active:scale-95 cursor-pointer bg-white dark:bg-white/5 hover:bg-slate-200/60 dark:hover:bg-white/10 text-slate-700 dark:text-white/70 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-white/10"
            title="Capture a thought"
          >
            <span className="material-symbols-outlined text-[20px]">add</span>
          </button>

          {/* Input field */}
          <input
            type="text"
            value={quickInput}
            onChange={(e) => setQuickInput(e.target.value)}
            placeholder="Ask Twin anything or draft a thought..."
            className="flex-1 bg-transparent border-none outline-none text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/30 text-sm sm:text-base focus:ring-0 px-2"
          />

          {/* Indigo Send Button */}
          <button
            type="submit"
            disabled={!quickInput.trim()}
            className={`w-10 h-10 flex items-center justify-center rounded-full transition-all shrink-0 cursor-pointer ${
              quickInput.trim()
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/40 hover:scale-105 active:scale-95'
                : 'bg-slate-200/80 dark:bg-white/5 text-slate-400 dark:text-white/30 opacity-60 cursor-not-allowed border border-slate-300/40 dark:border-white/5'
            }`}
            title="Send to Twin"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M5 12h14M12 5l7 7-7 7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </form>
      </section>

      {/* Right Now — Phase 24: Home's answer to "what matters right now",
          drawn from the real Personal Model (see HomeFocusCard). */}
      <HomeFocusCard onInspectFact={onInspectFact} />

      {/* Twin Noticed — Phase 15: a real, evidence-backed insight (see
          services/homeInsight.ts), never fabricated placeholder text.
          Hidden entirely rather than shown empty/loading, so Home never
          implies a pattern exists when Twin genuinely has nothing to say yet. */}
      {topInsight && (
        <section className="liquid-glass rounded-3xl p-6 sm:p-7 border-l-4 border-l-indigo-600 dark:border-l-indigo-500 relative overflow-hidden group shadow-xl">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-2xl bg-indigo-100 dark:bg-indigo-500/20 border border-indigo-200 dark:border-indigo-500/40 flex items-center justify-center shrink-0 text-indigo-600 dark:text-indigo-400 mt-0.5 shadow-sm">
              <span className="material-symbols-outlined text-xl">{INSIGHT_TYPE_ICON[topInsight.insightType]}</span>
            </div>
            <div className="flex-1 flex flex-col gap-2 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs uppercase tracking-widest text-indigo-600 dark:text-indigo-400 font-bold">
                  Twin Noticed
                </span>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full border uppercase tracking-wider shrink-0 ${STATUS_CLASS_COLOR[topInsight.statusClass]}`}
                >
                  {STATUS_CLASS_LABEL[topInsight.statusClass]}
                </span>
              </div>
              <p className="text-sm sm:text-base font-medium text-slate-800 dark:text-white/90 leading-relaxed">
                {topInsight.title}
              </p>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-white/60 leading-normal">{topInsight.description}</p>
              <p className="font-mono text-[11px] text-slate-500 dark:text-white/40">
                {confidenceLabel(topInsight.confidence)} · {topInsight.observationCount} observation
                {topInsight.observationCount === 1 ? '' : 's'}
              </p>

              <div className="flex items-center flex-wrap gap-2 sm:gap-3 pt-2">
                <button
                  onClick={onInspectTopInsight}
                  className="px-4 py-2 rounded-2xl bg-indigo-600 dark:bg-white text-white dark:text-black text-xs font-bold uppercase tracking-widest hover:bg-indigo-700 dark:hover:bg-indigo-50 transition-colors active:scale-95 shadow-md cursor-pointer"
                >
                  Why am I seeing this?
                </button>
                <button
                  onClick={onOpenTopInsightContext}
                  className="px-4 py-2 rounded-2xl liquid-glass border border-purple-500/30 text-purple-600 dark:text-purple-300 text-xs font-bold uppercase tracking-widest hover:border-purple-500/60 transition-colors active:scale-95 cursor-pointer"
                >
                  What This Connects To
                </button>
                <button
                  onClick={onDismissTopInsight}
                  className="px-3 py-2 rounded-2xl text-xs font-mono text-slate-500 dark:text-white/50 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Continue Where You Left Off — Phase 24: the user's own most
          recent real memory (memories are already ordered newest-first
          by the Memory API), never a fabricated project/thread. Omitted
          entirely when there's no memory yet, matching the "Twin
          Noticed" card's own hide-rather-than-fake-empty precedent. */}
      {continuationMemory && (
        <section className="relative">
          <div
            onClick={() => onSelectMemory(continuationMemory)}
            className="liquid-glass rounded-3xl p-6 sm:p-7 cursor-pointer group hover:border-indigo-500/50 transition-all duration-300 relative overflow-hidden shadow-xl"
          >
            <div className="flex flex-col gap-3 relative z-10">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs uppercase tracking-wider text-indigo-600 dark:text-indigo-300 font-semibold flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_#6366f1]" />
                  Continue Where You Left Off
                </span>
                <span className="material-symbols-outlined text-slate-400 dark:text-white/40 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 group-hover:translate-x-1 transition-all text-xl">
                  arrow_forward
                </span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
                <h3 className="text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white">
                  {continuationMemory.title}
                </h3>
                <span className="text-xs font-mono text-slate-500 dark:text-white/40">{continuationMemory.date}</span>
              </div>

              <p className="text-sm sm:text-base text-slate-600 dark:text-white/70 line-clamp-2 leading-relaxed font-light">
                {continuationMemory.description}
              </p>

              {continuationMemory.linkedEntity && (
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-xs font-mono bg-slate-100 dark:bg-white/10 px-2.5 py-1 rounded-md text-slate-700 dark:text-white/80 border border-slate-200 dark:border-white/10">
                    {continuationMemory.linkedEntity}
                  </span>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Recent Intelligence — Phase 24: replaces the previous hardcoded
          "Today" timeline (a fake meeting and a fake pending task) with
          the user's real Personal Model change log. */}
      <HomeIntelligenceFeed onInspectFact={onInspectFact} />

      {/* Recent Memories Carousel — already real since the Phase 7 API
          migration: every field here traces to a real captured memory. */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
            Recent Memories
          </h3>
          <button
            onClick={() => onSelectTab('memory')}
            className="font-mono text-xs uppercase tracking-wider text-indigo-600 dark:text-indigo-300 hover:underline transition-colors cursor-pointer"
          >
            View All ({memories.length})
          </button>
        </div>

        {memories.length === 0 ? (
          <div className="liquid-glass rounded-2xl p-5 text-center">
            <p className="text-sm text-slate-600 dark:text-[#c7c4d6]">Nothing captured yet.</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Use the capture button above to add your first memory.
            </p>
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto hide-scrollbar pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x snap-mandatory">
            {memories.slice(0, 5).map((memory) => (
              <div
                key={memory.id}
                onClick={() => onSelectMemory(memory)}
                className="snap-start shrink-0 w-64 h-48 rounded-2xl overflow-hidden relative liquid-glass group cursor-pointer hover:border-indigo-500/40 transition-all duration-300 shadow-xl"
              >
                {memory.imageUrl ? (
                  <img
                    src={memory.imageUrl}
                    alt={memory.title}
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/30 via-[#1a1a2e]/50 to-black/80" />
                )}
                {/* Frosted Gradient Overlay so text is always crisp */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

                <div className="absolute bottom-0 left-0 right-0 p-4 flex flex-col justify-end">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-[10px] tracking-wider text-white/70 uppercase">
                      {memory.date}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/20 text-white backdrop-blur-md border border-white/10">
                      {memory.source}
                    </span>
                  </div>
                  <h4 className="text-sm font-semibold text-white truncate">{memory.title}</h4>
                  <p className="text-xs text-white/70 line-clamp-1 mt-0.5">{memory.description}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
