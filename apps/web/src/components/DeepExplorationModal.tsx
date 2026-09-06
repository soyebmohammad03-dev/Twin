import React from 'react';
import type { InsightDto } from '@twin/contracts';
import { useEscapeToClose } from '../hooks/useEscapeToClose';

interface DeepExplorationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToTwin: (prompt: string) => void;
  /** Real, evidence-backed patterns (services/exploreInsight.ts's selection over GET /insights) — never invented here. */
  insights: InsightDto[];
  isLoading: boolean;
}

const CONFIDENCE_LABEL = (confidence: number) => `Confidence ${(confidence * 100).toFixed(0)}%`;

/**
 * Phase 21: Deep Exploration now surfaces Twin's real, already-computed
 * Insights (Phase 10-17's insights engine) instead of a fabricated
 * "Patagonia sabbatical" scenario. No LLM call happens in this
 * component — every insight shown here was already stored server-side,
 * the same rows ProfileView's InsightsSection and Home's highlight
 * card read from, just framed here as "converging threads" across the
 * user's real vault. An empty vault gets an honest "nothing detected
 * yet" state, never a placeholder pattern.
 */
export const DeepExplorationModal: React.FC<DeepExplorationModalProps> = ({
  isOpen,
  onClose,
  onNavigateToTwin,
  insights,
  isLoading,
}) => {
  useEscapeToClose(onClose, isOpen);
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
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Deep Exploration</h3>
              <p className="text-xs font-mono text-slate-500">Patterns Twin has noticed across your vault</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="space-y-4 my-4">
          {isLoading && <div className="py-10 text-center text-xs font-mono text-slate-400">Loading…</div>}

          {!isLoading && insights.length === 0 && (
            <div className="py-10 text-center">
              <span className="material-symbols-outlined text-3xl text-indigo-400/60">auto_awesome</span>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 max-w-sm mx-auto">
                Twin hasn't detected any patterns yet. Keep capturing memories — recurring topics, tensions between
                goals, and relationship patterns will surface here once there's enough evidence.
              </p>
            </div>
          )}

          {!isLoading && insights.length > 0 && (
            <div className="liquid-glass rounded-2xl p-4 border border-white/10 space-y-3">
              <h4 className="text-xs font-mono uppercase tracking-wider text-slate-400 font-semibold">
                {insights.length} converging thread{insights.length === 1 ? '' : 's'}
              </h4>
              {insights.map((insight) => (
                <div key={insight.id} className="liquid-glass rounded-xl p-3 border border-indigo-500/20">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm text-slate-900 dark:text-white">{insight.title}</strong>
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 shrink-0">
                      {CONFIDENCE_LABEL(insight.confidence)}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-700 dark:text-[#c7c4d6] mt-1.5 leading-relaxed">
                    {insight.description}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Action to brainstorm with Twin */}
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onNavigateToTwin(
                  insights.length > 0
                    ? `What should I do about "${insights[0]!.title}"?`
                    : 'What patterns have you noticed in my memories so far?',
                );
              }}
              className="flex-1 py-2.5 rounded-xl bg-[#4f4ccd] dark:bg-[#c2c1ff] text-white dark:text-[#1c0b9f] text-xs font-semibold hover:opacity-90 transition-all flex items-center justify-center gap-1.5 shadow-md active:scale-95"
            >
              <span className="material-symbols-outlined text-[16px]">chat</span>
              <span>Discuss with Twin</span>
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
