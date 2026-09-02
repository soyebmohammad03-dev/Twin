import React from 'react';

interface DeepExplorationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToTwin: (prompt: string) => void;
}

export const DeepExplorationModal: React.FC<DeepExplorationModalProps> = ({
  isOpen,
  onClose,
  onNavigateToTwin,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fadeIn">
      <div className="liquid-glass-heavy rounded-3xl w-full max-w-xl p-5 sm:p-6 border border-white/15 shadow-2xl relative overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
              <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                Deep Exploration Synthesis
              </h3>
              <p className="text-xs font-mono text-slate-500">Cross-Cluster Neural Discovery</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="space-y-4 my-4">
          <div className="liquid-glass rounded-2xl p-4 border border-indigo-500/30">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-indigo-400 uppercase tracking-wider font-semibold">
                Core Tension Detected
              </span>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                Confidence 96%
              </span>
            </div>
            <h4 className="text-base font-semibold text-slate-900 dark:text-white mt-1.5">
              Financial Conservation vs. Social Relationship Momentum
            </h4>
            <p className="text-xs sm:text-sm text-slate-700 dark:text-[#c7c4d6] mt-2 leading-relaxed">
              Twin analyzed your active decision to purchase a home ($500/mo allocation), your
              conversations with Sarah regarding the European trip, and your pending Berlin
              relocation. Sarah's sabbatical in Patagonia presents an opportunity window before
              December.
            </p>
          </div>

          <div className="liquid-glass rounded-2xl p-4 border border-white/10 space-y-2.5">
            <h4 className="text-xs font-mono uppercase tracking-wider text-slate-400 font-semibold">
              3 Converging Threads
            </h4>

            <div className="flex items-start gap-2.5 text-xs text-slate-300">
              <span className="material-symbols-outlined text-indigo-400 text-sm mt-0.5">
                check_circle
              </span>
              <div>
                <strong className="text-white">Project Helios Sprints:</strong> Demands 15 focus
                hours weekly through mid-November.
              </div>
            </div>

            <div className="flex items-start gap-2.5 text-xs text-slate-300">
              <span className="material-symbols-outlined text-amber-400 text-sm mt-0.5">
                check_circle
              </span>
              <div>
                <strong className="text-white">London vs. Berlin Relocation:</strong> Ties to Q1
                budget decisions with Sarah's quantum engineering team.
              </div>
            </div>

            <div className="flex items-start gap-2.5 text-xs text-slate-300">
              <span className="material-symbols-outlined text-emerald-400 text-sm mt-0.5">
                check_circle
              </span>
              <div>
                <strong className="text-white">House Savings Fund:</strong> Requires maintaining $500
                minimum deposits over 6 consecutive cycles.
              </div>
            </div>
          </div>

          {/* Action to brainstorm with Twin */}
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onNavigateToTwin('Synthesize an action plan balancing the trip with Sarah and my house savings goal');
              }}
              className="flex-1 py-2.5 rounded-xl bg-[#4f4ccd] dark:bg-[#c2c1ff] text-white dark:text-[#1c0b9f] text-xs font-semibold hover:opacity-90 transition-all flex items-center justify-center gap-1.5 shadow-md active:scale-95"
            >
              <span className="material-symbols-outlined text-[16px]">chat</span>
              <span>Brainstorm Strategy with Twin</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="py-2.5 px-4 rounded-xl liquid-glass text-xs font-mono text-slate-300 hover:bg-white/10"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
