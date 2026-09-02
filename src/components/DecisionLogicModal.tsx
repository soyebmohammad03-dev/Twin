import React, { useState } from 'react';
import { DecisionItem } from '../types';

interface DecisionLogicModalProps {
  isOpen: boolean;
  onClose: () => void;
  decision: DecisionItem;
  onFinalize: () => void;
  onAddPro: (pro: string) => void;
  onAddCon: (con: string) => void;
}

export const DecisionLogicModal: React.FC<DecisionLogicModalProps> = ({
  isOpen,
  onClose,
  decision,
  onFinalize,
  onAddPro,
  onAddCon,
}) => {
  const [newPro, setNewPro] = useState('');
  const [newCon, setNewCon] = useState('');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fadeIn">
      <div className="liquid-glass-heavy rounded-3xl w-full max-w-xl p-5 sm:p-6 border border-white/15 shadow-2xl relative overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <span className="material-symbols-outlined text-[18px]">psychology</span>
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                Decision Logic &amp; Tradeoffs
              </h3>
              <p className="text-xs font-mono text-slate-500">{decision.title}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {/* Weighting bar */}
        <div className="my-4 liquid-glass rounded-2xl p-4 border border-white/10">
          <div className="flex items-center justify-between text-xs font-mono mb-2">
            <span className="text-slate-500 dark:text-slate-400">Algorithmic Balance</span>
            <span className="text-emerald-400 font-semibold">+{decision.proWeight}% in favor</span>
          </div>
          <div className="h-2.5 w-full bg-white/10 rounded-full flex overflow-hidden">
            <div
              className="h-full bg-emerald-400 transition-all duration-500"
              style={{ width: `${50 + decision.proWeight / 2}%` }}
            />
            <div
              className="h-full bg-amber-400/50 transition-all duration-500"
              style={{ width: `${50 - decision.proWeight / 2}%` }}
            />
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-2.5 leading-relaxed">
            {decision.description}
          </p>
        </div>

        {/* Pros & Cons Columns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-4">
          {/* Pros */}
          <div className="space-y-2">
            <h4 className="text-xs font-mono uppercase tracking-wider text-emerald-400 font-semibold flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">check_circle</span>
              Pros ({decision.pros.length})
            </h4>
            <div className="space-y-1.5">
              {decision.pros.map((p, idx) => (
                <div
                  key={idx}
                  className="text-xs text-slate-700 dark:text-slate-300 liquid-glass p-2.5 rounded-xl border border-emerald-500/20"
                >
                  {p}
                </div>
              ))}
            </div>
            {/* Add Pro */}
            <div className="flex gap-1 pt-1">
              <input
                type="text"
                value={newPro}
                onChange={(e) => setNewPro(e.target.value)}
                placeholder="Add pro factor..."
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white placeholder:text-slate-500 outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  if (newPro.trim()) {
                    onAddPro(newPro.trim());
                    setNewPro('');
                  }
                }}
                className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-mono hover:bg-emerald-500/30"
              >
                Add
              </button>
            </div>
          </div>

          {/* Cons */}
          <div className="space-y-2">
            <h4 className="text-xs font-mono uppercase tracking-wider text-amber-400 font-semibold flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">warning</span>
              Cons ({decision.cons.length})
            </h4>
            <div className="space-y-1.5">
              {decision.cons.map((c, idx) => (
                <div
                  key={idx}
                  className="text-xs text-slate-700 dark:text-slate-300 liquid-glass p-2.5 rounded-xl border border-amber-500/20"
                >
                  {c}
                </div>
              ))}
            </div>
            {/* Add Con */}
            <div className="flex gap-1 pt-1">
              <input
                type="text"
                value={newCon}
                onChange={(e) => setNewCon(e.target.value)}
                placeholder="Add con constraint..."
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white placeholder:text-slate-500 outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  if (newCon.trim()) {
                    onAddCon(newCon.trim());
                    setNewCon('');
                  }
                }}
                className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-400 text-xs font-mono hover:bg-amber-500/30"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-3">
          <span className="text-[11px] font-mono text-slate-400">
            {decision.status === 'finalized' ? 'Status: Finalized & Logged' : 'Status: In Active Deliberation'}
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-full text-xs font-mono text-slate-400 hover:text-white"
            >
              Close
            </button>
            {decision.status === 'unresolved' && (
              <button
                type="button"
                onClick={() => {
                  onFinalize();
                  onClose();
                }}
                className="px-5 py-2 rounded-full bg-[#4f4ccd] dark:bg-[#c2c1ff] text-white dark:text-[#1c0b9f] text-xs font-semibold hover:opacity-90 transition-all shadow-md active:scale-95"
              >
                Finalize Decision
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
