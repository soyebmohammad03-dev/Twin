import React, { useEffect, useState } from 'react';
import { personalModelApi } from '../services/personalModelApi';
import { selectFocusFact } from '../services/homeIntelligence';

interface HomeFocusCardProps {
  /** Opens the existing FactEvidenceModal (Phase 9/23) for the highlighted fact — reused, not duplicated. */
  onInspectFact: (factId: string) => void;
}

/**
 * Phase 24 — Home's answer to "what matters right now", drawn straight
 * from the real Personal Model (Phase 9). Read-only: this never calls
 * rebuild() itself (Profile's own visit already keeps the model fresh
 * — see "never rebuild on every page load"), it just reads whatever
 * current() returns, exactly like DigitalTwinOverview and
 * ModelEvolutionSection already do independently.
 *
 * Deliberately shows at most one fact — Home is a curated highlight,
 * not a second Personal Model list (Profile already owns the full
 * view). If Twin has no fact in an eligible category yet, this shows
 * an honest empty state rather than reaching into an unrelated
 * category or inventing something to say.
 */
export const HomeFocusCard: React.FC<HomeFocusCardProps> = ({ onInspectFact }) => {
  const [focusText, setFocusText] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    personalModelApi
      .getModel()
      .then((model) => {
        if (cancelled) return;
        const fact = selectFocusFact(model.facts);
        setFocusText(fact?.factText ?? null);
        setFocusId(fact?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't read your Personal Model right now.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="liquid-glass rounded-3xl p-6 sm:p-7 border-l-4 border-l-emerald-500 dark:border-l-emerald-400 relative overflow-hidden shadow-xl">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-500/20 border border-emerald-200 dark:border-emerald-500/40 flex items-center justify-center shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5 shadow-sm">
          <span className="material-symbols-outlined text-xl">adjust</span>
        </div>
        <div className="flex-1 flex flex-col gap-2 min-w-0">
          <span className="font-mono text-xs uppercase tracking-widest text-emerald-600 dark:text-emerald-400 font-bold">
            Right Now
          </span>

          {loading && <p className="text-sm text-slate-500 dark:text-white/50">Reading your Personal Model…</p>}

          {!loading && error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

          {!loading && !error && focusText && (
            <>
              <p className="text-sm sm:text-base font-medium text-slate-800 dark:text-white/90 leading-relaxed">
                {focusText}
              </p>
              <button
                onClick={() => focusId && onInspectFact(focusId)}
                className="self-start text-xs font-mono text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer mt-1"
              >
                Why does Twin think this?
              </button>
            </>
          )}

          {!loading && !error && !focusText && (
            <p className="text-sm text-slate-500 dark:text-white/50 leading-relaxed">
              Twin doesn't have a clear focus for you yet. Capture a few thoughts about your goals or projects and
              this will fill in.
            </p>
          )}
        </div>
      </div>
    </section>
  );
};
