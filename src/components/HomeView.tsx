import React, { useState } from 'react';
import { MemoryItem, DecisionItem, TabType } from '../types';

interface HomeViewProps {
  onSelectTab: (tab: TabType) => void;
  onAskTwin: (query: string) => void;
  memories: MemoryItem[];
  decision: DecisionItem;
  onOpenDecisionLogic: () => void;
  onFinalizeDecision: () => void;
  onSynthesizeInsight: (insightTopic: string) => void;
  onSelectMemory: (mem: MemoryItem) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  onSelectTab,
  onAskTwin,
  memories,
  decision,
  onOpenDecisionLogic,
  onFinalizeDecision,
  onSynthesizeInsight,
  onSelectMemory,
}) => {
  const [quickInput, setQuickInput] = useState('');
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');

  const handleQuickSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickInput.trim()) return;
    onAskTwin(quickInput.trim());
    setQuickInput('');
  };

  const toggleSimulatedVoice = () => {
    if (!isVoiceActive) {
      setIsVoiceActive(true);
      setVoiceTranscript('Listening... "Remind me about the discussion with Sarah"');
      setTimeout(() => {
        setQuickInput('What did Sarah and I agree on regarding the Q3 budget?');
        setIsVoiceActive(false);
      }, 1800);
    } else {
      setIsVoiceActive(false);
    }
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
            Good evening, <span className="font-semibold text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 dark:from-indigo-300 dark:via-purple-300 dark:to-pink-300">Alex</span>.
          </h1>
          <p className="text-sm sm:text-base text-slate-600 dark:text-white/60 font-light max-w-xl leading-relaxed">
            I've synthesized your key action items from today's discussions regarding the <span className="text-indigo-600 dark:text-indigo-300 border-b border-indigo-400/40 font-medium">system design</span> and financial priorities.
          </p>
        </div>

        {/* 2-Column Insight & Context Bento */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4 text-left my-4 sm:my-6">
          <div
            onClick={() => onSelectTab('twin')}
            className="p-4 sm:p-5 liquid-glass rounded-2xl hover:border-indigo-500/50 transition-all cursor-pointer group/card"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="block text-[10px] text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-wider">Insight</span>
              <span className="material-symbols-outlined text-[15px] text-slate-400 dark:text-white/30 group-hover/card:text-indigo-600 dark:group-hover/card:text-indigo-300 transition-colors">arrow_forward</span>
            </div>
            <p className="text-sm font-medium text-slate-800 dark:text-white/90 leading-snug">
              Sarah's hesitation on the trip correlates with the Q3 house savings milestone.
            </p>
          </div>

          <div
            onClick={() => onSelectTab('explore')}
            className="p-4 sm:p-5 liquid-glass rounded-2xl hover:border-purple-500/50 transition-all cursor-pointer group/card"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="block text-[10px] text-purple-600 dark:text-purple-400 font-bold uppercase tracking-wider">Context</span>
              <span className="material-symbols-outlined text-[15px] text-slate-400 dark:text-white/30 group-hover/card:text-purple-600 dark:group-hover/card:text-purple-300 transition-colors">hub</span>
            </div>
            <p className="text-sm font-medium text-slate-800 dark:text-white/90 leading-snug">
              You usually prefer a phased rollout for liquid glass UI token updates.
            </p>
          </div>
        </div>

        {/* Central Frosted Input Bar */}
        <form
          onSubmit={handleQuickSubmit}
          className="mt-2 flex items-center gap-2 sm:gap-3 bg-slate-100/90 dark:bg-white/10 border border-slate-200 dark:border-white/10 p-2 sm:p-2.5 rounded-full shadow-xs backdrop-blur-xl focus-within:ring-2 focus-within:ring-indigo-500/50 transition-all"
        >
          {/* Voice/Mic Button */}
          <button
            type="button"
            onClick={toggleSimulatedVoice}
            className={`w-10 h-10 flex items-center justify-center rounded-full transition-all shrink-0 active:scale-95 cursor-pointer ${
              isVoiceActive
                ? 'bg-rose-500 text-white animate-pulse shadow-lg shadow-rose-500/40'
                : 'bg-white dark:bg-white/5 hover:bg-slate-200/60 dark:hover:bg-white/10 text-slate-700 dark:text-white/70 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-white/10'
            }`}
            title="Voice Input to Twin"
          >
            <span
              className="material-symbols-outlined text-[20px]"
              style={{ fontVariationSettings: isVoiceActive ? "'FILL' 1" : "'FILL' 0" }}
            >
              mic
            </span>
          </button>

          {/* Input field */}
          <input
            type="text"
            value={quickInput}
            onChange={(e) => setQuickInput(e.target.value)}
            placeholder={isVoiceActive ? voiceTranscript : "Ask Twin anything or draft a thought..."}
            className="flex-1 bg-transparent border-none outline-none text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/30 text-sm sm:text-base focus:ring-0 px-2"
          />

          {/* Auxiliary Action Buttons */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onAskTwin('Capture screenshot memo from my active design presentation')}
              className="w-9 h-9 rounded-full hidden sm:flex items-center justify-center text-slate-500 dark:text-white/50 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10 transition-colors cursor-pointer"
              title="Capture screen note"
            >
              <span className="material-symbols-outlined text-[19px]">photo_camera</span>
            </button>

            <button
              type="button"
              onClick={() => onAskTwin('Attach recent notes about Project Helios')}
              className="w-9 h-9 rounded-full hidden sm:flex items-center justify-center text-slate-500 dark:text-white/50 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10 transition-colors cursor-pointer"
              title="Attach memory reference"
            >
              <span className="material-symbols-outlined text-[19px]">attach_file</span>
            </button>

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
          </div>
        </form>
      </section>

      {/* Pattern Detected Contextual Chip */}
      <section className="flex flex-wrap items-center gap-2 px-1">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full liquid-glass text-xs font-mono text-slate-700 dark:text-white/80 shadow-xs">
          <span className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_#6366f1] animate-pulse" />
          <span className="text-slate-500 dark:text-white/40 uppercase">Pattern Detected:</span>
          <span className="font-semibold text-slate-900 dark:text-white">
            Focus hours usually begin at 9 PM
          </span>
        </div>

        <button
          onClick={() => onSelectTab('explore')}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full liquid-glass hover:border-indigo-500/50 text-xs font-mono text-indigo-600 dark:text-indigo-300 transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-[14px]">hub</span>
          <span>View 4 clusters</span>
        </button>
      </section>

      {/* Continue Where You Left Off (Project Helios) */}
      <section className="relative">
        <div
          onClick={() => onSelectTab('twin')}
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
                Project Helios
              </h3>
              <span className="text-xs font-mono text-slate-500 dark:text-white/40">
                Last edited 2h ago
              </span>
            </div>

            <p className="text-sm sm:text-base text-slate-600 dark:text-white/70 line-clamp-2 leading-relaxed font-light">
              Drafting the final system architecture review. You have 3 unread comments from the
              design team regarding the main API gateway structure and liquid glass UI tokens.
            </p>

            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs font-mono bg-slate-100 dark:bg-white/10 px-2.5 py-1 rounded-md text-slate-700 dark:text-white/80 border border-slate-200 dark:border-white/10">
                Sarah Jenkins (Lead)
              </span>
              <span className="text-xs font-mono bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 px-2.5 py-1 rounded-md border border-amber-200 dark:border-amber-500/30">
                3 comments pending
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Twin Noticed / Insight Card */}
      <section className="liquid-glass rounded-3xl p-6 sm:p-7 border-l-4 border-l-indigo-600 dark:border-l-indigo-500 relative overflow-hidden group shadow-xl">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-2xl bg-indigo-100 dark:bg-indigo-500/20 border border-indigo-200 dark:border-indigo-500/40 flex items-center justify-center shrink-0 text-indigo-600 dark:text-indigo-400 mt-0.5 shadow-sm">
            <span className="material-symbols-outlined text-xl">lightbulb</span>
          </div>
          <div className="flex-1 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs uppercase tracking-widest text-indigo-600 dark:text-indigo-400 font-bold">
                Twin Noticed
              </span>
              <span className="font-mono text-[11px] text-slate-500 dark:text-white/40">4 recurrences</span>
            </div>
            <p className="text-sm sm:text-base font-medium text-slate-800 dark:text-white/90 leading-relaxed">
              You've returned to the concept of <span className="text-indigo-600 dark:text-indigo-300 underline decoration-indigo-400/50 font-semibold">"Liquid Interfaces"</span> 4 times this week across 3 notes and 1 conversation.
            </p>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-white/60 leading-normal">
              Would you like to synthesize these scattered thoughts into a formal architectural note?
            </p>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => onSynthesizeInsight('Liquid Interfaces')}
                className="px-4 py-2 rounded-2xl bg-indigo-600 dark:bg-white text-white dark:text-black text-xs font-bold uppercase tracking-widest hover:bg-indigo-700 dark:hover:bg-indigo-50 transition-colors active:scale-95 shadow-md cursor-pointer"
              >
                Synthesize into Note
              </button>
              <button
                onClick={() => onAskTwin('Why did Twin highlight the Liquid Interfaces pattern?')}
                className="px-3 py-2 rounded-2xl text-xs font-mono text-slate-500 dark:text-white/50 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
              >
                Explore Context
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Unresolved Decision Card (Interactive) */}
      <section className="liquid-glass rounded-3xl p-6 sm:p-7 relative overflow-hidden shadow-xl">
        <div className="absolute -top-12 -right-12 w-36 h-36 bg-amber-500/10 blur-3xl rounded-full pointer-events-none" />
        <div className="flex flex-col gap-3.5 relative z-10">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-widest text-amber-600 dark:text-amber-300 font-semibold flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[15px]">psychology</span>
              Unresolved Decision
            </span>
            <span className="font-mono text-xs text-slate-500 dark:text-white/40">
              {decision.status === 'finalized' ? (
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">Finalized</span>
              ) : (
                `Active for ${decision.duration}`
              )}
            </span>
          </div>

          <div>
            <h3 className="text-xl font-semibold text-slate-900 dark:text-white">
              {decision.title}
            </h3>
            <p className="text-sm text-slate-600 dark:text-white/70 mt-1.5 leading-relaxed font-light">
              {decision.description}
            </p>
          </div>

          {/* Pros vs Cons Bar with Glowing Accent */}
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-xs font-mono text-slate-500 dark:text-white/50">
              <span>Career advancement weighting</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">+{decision.proWeight}% positive variance</span>
            </div>
            <div className="h-2 w-full bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden flex">
              <div
                className="h-full bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_8px_#10b981] transition-all duration-500"
                style={{ width: `${50 + decision.proWeight / 2}%` }}
              />
              <div
                className="h-full bg-amber-500/40 dark:bg-amber-400/50 transition-all duration-500"
                style={{ width: `${50 - decision.proWeight / 2}%` }}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={onOpenDecisionLogic}
              className="flex-1 py-2.5 px-3 rounded-2xl liquid-glass hover:border-slate-400 dark:hover:border-white/30 text-xs sm:text-sm font-medium text-slate-800 dark:text-white transition-all active:scale-98 text-center cursor-pointer"
            >
              Review Logic & Tradeoffs
            </button>

            {decision.status === 'unresolved' ? (
              <button
                onClick={onFinalizeDecision}
                className="flex-1 py-2.5 px-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs sm:text-sm font-semibold shadow-lg shadow-indigo-600/40 transition-all active:scale-98 text-center cursor-pointer"
              >
                Finalize Decision
              </button>
            ) : (
              <span className="flex-1 py-2.5 px-3 rounded-2xl bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs sm:text-sm font-medium text-center border border-emerald-200 dark:border-emerald-500/30">
                Decision Archived
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Today Timeline Highlights */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
            Today
          </span>
          <span className="font-mono text-[11px] text-slate-500 dark:text-white/40">Wednesday</span>
        </div>

        <div className="space-y-3">
          <div className="liquid-glass rounded-2xl p-4 flex items-start gap-3 hover:border-indigo-500/40 transition-colors">
            <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_#6366f1] shrink-0 mt-1.5" />
            <span className="font-mono text-xs text-indigo-600 dark:text-indigo-300 shrink-0 mt-0.5 font-medium">
              10:00 AM
            </span>
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                Meeting with Sarah regarding Q3 Roadmap
              </p>
              <p className="text-xs text-slate-500 dark:text-white/50 mt-0.5">
                Twin prepared 4 savings vs project context notes
              </p>
            </div>
            <button
              onClick={() => onSelectTab('twin')}
              className="text-xs font-mono text-indigo-600 dark:text-indigo-400 hover:underline shrink-0 cursor-pointer"
            >
              Open Prep
            </button>
          </div>

          <div className="liquid-glass rounded-2xl p-4 flex items-start gap-3 hover:border-amber-500/40 transition-colors">
            <div className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_#f59e0b] shrink-0 mt-1.5" />
            <span className="font-mono text-xs text-amber-600 dark:text-amber-300 shrink-0 mt-0.5 font-medium">
              Pending
            </span>
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                Finalize resource allocation for Project Helios
              </p>
              <p className="text-xs text-slate-500 dark:text-white/50 mt-0.5">
                Target: 2 senior frontend contract allocations
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Recent Memories Carousel */}
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
                <h4 className="text-sm font-semibold text-white truncate">
                  {memory.title}
                </h4>
                <p className="text-xs text-white/70 line-clamp-1 mt-0.5">
                  {memory.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
