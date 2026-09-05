import React, { useState } from 'react';
import type { DecisionDto } from '@twin/contracts';
import { decisionsApi } from '../services/decisionsApi';

interface DecisionCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (decision: DecisionDto) => void;
}

/**
 * Phase 26's "Record a decision" flow — the user-facing entry point
 * Phase 25 was missing (decisions could previously only be created via
 * the API or AI extraction). Collects only fields the real POST
 * /decisions API supports: name, description, and — since a user is
 * often recording a decision they already made, not starting a new
 * open one — an optional status/outcome/date so that case doesn't need
 * a create-then-immediately-patch round trip.
 */
export const DecisionCreateModal: React.FC<DecisionCreateModalProps> = ({ isOpen, onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [alreadyDecided, setAlreadyDecided] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [decidedAt, setDecidedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName('');
    setDescription('');
    setAlreadyDecided(false);
    setOutcome('');
    setDecidedAt(new Date().toISOString().slice(0, 10));
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const decision = await decisionsApi.create({
        name: name.trim(),
        description: description.trim() || undefined,
        status: alreadyDecided ? 'decided' : undefined,
        outcome: alreadyDecided && outcome.trim() ? outcome.trim() : undefined,
        decidedAt: alreadyDecided && decidedAt ? new Date(decidedAt).toISOString() : undefined,
      });
      reset();
      onCreated(decision);
    } catch {
      setError("Couldn't record this decision right now.");
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
      <form
        onSubmit={handleSubmit}
        className="liquid-glass-heavy rounded-3xl w-full max-w-lg p-5 sm:p-6 border border-white/15 shadow-2xl relative overflow-hidden max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-indigo-400 text-xl">balance</span>
            <span className="font-mono text-xs text-indigo-400 uppercase tracking-widest">Record a decision</span>
          </div>
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        <div className="space-y-4 my-4">
          <div className="space-y-1.5">
            <label className="text-xs font-mono uppercase tracking-wider text-slate-400">
              What decision is this? <span className="text-rose-400">*</span>
            </label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Choose remote-first role"
              maxLength={500}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-indigo-400/50"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-mono uppercase tracking-wider text-slate-400">Context (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Any context worth recording alongside it"
              rows={2}
              maxLength={5000}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-indigo-400/50 resize-none"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={alreadyDecided}
              onChange={(e) => setAlreadyDecided(e.target.checked)}
              className="w-4 h-4 rounded accent-indigo-500"
            />
            <span className="text-sm text-slate-700 dark:text-slate-300">I've already made this decision</span>
          </label>

          {alreadyDecided && (
            <div className="liquid-glass rounded-2xl p-4 border border-white/10 space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-mono uppercase tracking-wider text-slate-400">What did you decide? (optional)</label>
                <input
                  type="text"
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  placeholder="e.g. Accepted the offer"
                  maxLength={2000}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-indigo-400/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-mono uppercase tracking-wider text-slate-400">Date</label>
                <input
                  type="date"
                  value={decidedAt}
                  onChange={(e) => setDecidedAt(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-indigo-400/50"
                />
              </div>
            </div>
          )}

          {error && <p className="text-xs font-mono text-red-400">{error}</p>}
        </div>

        <div className="pt-3 border-t border-white/10 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="px-4 py-2 rounded-full text-xs font-mono text-slate-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || saving}
            className="px-5 py-2 rounded-full bg-[#4f4ccd] dark:bg-[#c2c1ff] text-white dark:text-[#1c0b9f] text-xs font-semibold hover:opacity-90 transition-all shadow-md active:scale-95 disabled:opacity-50"
          >
            {saving ? 'Recording…' : 'Record decision'}
          </button>
        </div>
      </form>
    </div>
  );
};
