import React, { useState } from 'react';
import type { DecisionDto, DecisionStatus } from '@twin/contracts';
import { DecisionCreateModal } from './DecisionCreateModal';

interface DecisionsSectionProps {
  /** Phase 27: lifted to App.tsx (GET /decisions fetched on Profile visit) so DecisionDetailModal's mutations can patch this same array directly — fixes the Phase 26 bug where this list's hasEvidence badge went stale until the section remounted. */
  decisions: DecisionDto[];
  isLoading: boolean;
  error: string | null;
  onOpenDecision: (decisionId: string) => void;
  onDecisionCreated: (decision: DecisionDto) => void;
}

const STATUS_LABEL: Record<DecisionStatus, string> = {
  open: 'Open',
  decided: 'Decided',
  reversed: 'Reversed',
};

const STATUS_COLOR: Record<DecisionStatus, string> = {
  open: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  decided: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  reversed: 'text-slate-400 border-slate-500/30 bg-slate-500/10',
};

type StatusFilter = 'all' | DecisionStatus;

/**
 * Phase 26's first-class Decisions Home — replaces "only reachable
 * through the Knowledge Graph" with a real list backed by GET
 * /decisions, mirroring InsightsSection's established structural
 * pattern (loading/error/empty/populated, real data only). No counts,
 * confidence values, or evidence indicators are shown unless the
 * backend actually computed them (see decisionDtoSchema.hasEvidence).
 *
 * Phase 27: purely presentational now — `decisions` is owned by
 * App.tsx (the same lifted-state pattern already used for `entities`),
 * so this component never goes stale relative to a mutation made
 * elsewhere (DecisionDetailModal calls back up to App.tsx, which
 * patches the shared array in place).
 */
export const DecisionsSection: React.FC<DecisionsSectionProps> = ({ decisions, isLoading, error, onOpenDecision, onDecisionCreated }) => {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  if (isLoading) {
    return (
      <section className="space-y-3">
        <SectionHeading onRecord={() => setIsCreateOpen(true)} />
        <div className="flex items-center justify-center py-10 text-xs font-mono text-slate-400">Loading your decisions…</div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="space-y-3">
        <SectionHeading onRecord={() => setIsCreateOpen(true)} />
        <p className="text-xs font-mono text-red-400 text-center py-6">{error}</p>
      </section>
    );
  }

  const filtered = statusFilter === 'all' ? decisions : decisions.filter((d) => d.status === statusFilter);
  const counts: Record<StatusFilter, number> = {
    all: decisions.length,
    open: decisions.filter((d) => d.status === 'open').length,
    decided: decisions.filter((d) => d.status === 'decided').length,
    reversed: decisions.filter((d) => d.status === 'reversed').length,
  };

  return (
    <section className="space-y-3">
      <SectionHeading onRecord={() => setIsCreateOpen(true)} />

      {decisions.length === 0 && (
        <div className="liquid-glass rounded-3xl p-6 border border-slate-200/80 dark:border-white/10 text-center">
          <p className="text-sm text-slate-600 dark:text-[#c7c4d6]">No decisions recorded yet.</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-3">
            Record a decision to start tracking what you chose, why, and what evidence supports it.
          </p>
          <button
            onClick={() => setIsCreateOpen(true)}
            className="px-4 py-2 rounded-full bg-[#4f4ccd] dark:bg-[#c2c1ff] text-white dark:text-[#1c0b9f] text-xs font-semibold hover:opacity-90 transition-all shadow-md active:scale-95"
          >
            Record a decision
          </button>
        </div>
      )}

      {decisions.length > 0 && (
        <>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {(['all', 'open', 'decided', 'reversed'] as StatusFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={`shrink-0 text-[10px] font-mono px-2.5 py-1 rounded-full border uppercase tracking-wider transition-colors ${
                  statusFilter === f
                    ? 'bg-indigo-500/20 border-indigo-400/40 text-indigo-300'
                    : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200'
                }`}
              >
                {f === 'all' ? 'All' : STATUS_LABEL[f]} ({counts[f]})
              </button>
            ))}
          </div>

          {filtered.length === 0 && (
            <p className="text-xs text-slate-500 font-mono text-center py-6">No decisions with this status.</p>
          )}

          <div className="space-y-2">
            {filtered.map((decision) => (
              <DecisionRow key={decision.id} decision={decision} onClick={() => onOpenDecision(decision.id)} />
            ))}
          </div>
        </>
      )}

      <DecisionCreateModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={(decision) => {
          setIsCreateOpen(false);
          onDecisionCreated(decision);
          onOpenDecision(decision.id);
        }}
      />
    </section>
  );
};

const SectionHeading: React.FC<{ onRecord: () => void }> = ({ onRecord }) => (
  <div className="flex items-center justify-between px-1">
    <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
      <span className="material-symbols-outlined text-indigo-500 dark:text-indigo-400 text-xl">balance</span>
      Decisions
    </h3>
    <button
      onClick={onRecord}
      className="flex items-center gap-1 text-xs font-mono text-indigo-400 hover:underline"
    >
      <span className="material-symbols-outlined text-[16px]">add</span>
      Record
    </button>
  </div>
);

const DecisionRow: React.FC<{ decision: DecisionDto; onClick: () => void }> = ({ decision, onClick }) => (
  <button
    onClick={onClick}
    className="w-full text-left liquid-glass rounded-2xl p-3.5 border border-white/10 hover:border-indigo-400/40 transition-all"
  >
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{decision.name}</p>
        {decision.outcome && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">{decision.outcome}</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border uppercase tracking-wider ${STATUS_COLOR[decision.status]}`}>
            {STATUS_LABEL[decision.status]}
          </span>
          {decision.decidedAt && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-500/10 border border-slate-500/30 text-slate-400">
              {new Date(decision.decidedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          )}
          {!decision.hasEvidence && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-500/10 border border-slate-500/30 text-slate-500">
              Nothing linked yet
            </span>
          )}
        </div>
      </div>
      <span className="material-symbols-outlined text-slate-500 text-base shrink-0">chevron_right</span>
    </div>
  </button>
);
