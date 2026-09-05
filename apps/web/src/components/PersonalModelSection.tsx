import React, { useCallback, useEffect, useState } from 'react';
import type { PersonalModelFactDto, PersonalModelCategory } from '@twin/contracts';
import { personalModelApi } from '../services/personalModelApi';

interface PersonalModelSectionProps {
  onInspectFact: (factId: string) => void;
}

const CATEGORY_LABEL: Record<PersonalModelCategory, string> = {
  important_people: 'Important People',
  active_projects: 'Active Projects',
  goals: 'Goals',
  decisions: 'Decisions',
  knowledge_areas: 'Knowledge Areas',
  recurring_topics: 'Recurring Topics',
  preferences: 'Preferences',
  constraints: 'Constraints',
  current_priorities: 'Current Priorities',
};

// Category ordering that reads naturally to a user, per item 20's list.
const CATEGORY_ORDER: PersonalModelCategory[] = [
  'active_projects',
  'goals',
  'important_people',
  'current_priorities',
  'preferences',
  'decisions',
  'knowledge_areas',
  'recurring_topics',
  'constraints',
];

/** Exported so Phase 16's InsightContextModal can label a fact's temporal state identically to this section, instead of duplicating the copy. */
export const TEMPORAL_BADGE: Partial<Record<string, string>> = {
  historical: 'Historical',
  superseded: 'Replaced by something more recent',
  outdated: 'Corrected — no longer accurate',
};

/**
 * Phase 9's Personal Model view — item 20. Real backend data only (no
 * mock counts here); reached from ProfileView. Deliberately shows
 * category groups + progressive-disclosure "why" rather than raw
 * database fields (no fact ids, no epistemic enum names visible by
 * default — see FactEvidenceModal for the plain-language version of
 * epistemicStatus).
 */
export const PersonalModelSection: React.FC<PersonalModelSectionProps> = ({ onInspectFact }) => {
  const [facts, setFacts] = useState<PersonalModelFactDto[] | null>(null);
  const [uncertainIds, setUncertainIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyFactId, setBusyFactId] = useState<string | null>(null);
  const [correctingFactId, setCorrectingFactId] = useState<string | null>(null);
  const [correctionText, setCorrectionText] = useState('');

  const load = useCallback(async (rebuildFirst: boolean) => {
    setLoading(true);
    setError(null);
    try {
      if (rebuildFirst) await personalModelApi.rebuild();
      const result = await personalModelApi.getModel();
      setFacts(result.facts);
      setUncertainIds(new Set(result.uncertainFactIds));
    } catch {
      setError("Couldn't load your Personal Model right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  async function handleConfirm(factId: string) {
    setBusyFactId(factId);
    try {
      await personalModelApi.confirmFact(factId);
      await load(false);
    } finally {
      setBusyFactId(null);
    }
  }

  async function handleDismiss(factId: string) {
    setBusyFactId(factId);
    try {
      await personalModelApi.dismissFact(factId);
      await load(false);
    } finally {
      setBusyFactId(null);
    }
  }

  async function handleSubmitCorrection(factId: string) {
    const text = correctionText.trim();
    if (!text) return;
    setBusyFactId(factId);
    try {
      await personalModelApi.correctFact(factId, { correctedText: text });
      setCorrectingFactId(null);
      setCorrectionText('');
      await load(false);
    } finally {
      setBusyFactId(null);
    }
  }

  if (loading) {
    return (
      <section className="space-y-3">
        <SectionHeading />
        <div className="flex items-center justify-center py-10 text-xs font-mono text-slate-400">
          Building your Personal Model…
        </div>
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

  const allFacts = facts ?? [];
  const grouped = new Map<PersonalModelCategory, PersonalModelFactDto[]>();
  for (const fact of allFacts) {
    const list = grouped.get(fact.category) ?? [];
    list.push(fact);
    grouped.set(fact.category, list);
  }
  const uncertainFacts = allFacts.filter((f) => uncertainIds.has(f.id));

  return (
    <section className="space-y-3">
      <SectionHeading />

      {allFacts.length === 0 && (
        <div className="liquid-glass rounded-3xl p-6 border border-slate-200/80 dark:border-white/10 text-center">
          <p className="text-sm text-slate-600 dark:text-[#c7c4d6]">
            Twin doesn't have enough evidence yet to build your Personal Model.
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Capture a few memories about your projects, people, and preferences, then come back here.
          </p>
        </div>
      )}

      {CATEGORY_ORDER.filter((c) => grouped.has(c)).map((category) => (
        <div key={category} className="space-y-2">
          <h4 className="text-xs font-mono uppercase tracking-wider text-slate-400 px-1">
            {CATEGORY_LABEL[category]} ({grouped.get(category)!.length})
          </h4>
          <div className="space-y-2">
            {grouped.get(category)!.map((fact) => (
              <FactRow
                key={fact.id}
                fact={fact}
                isUncertain={uncertainIds.has(fact.id)}
                isBusy={busyFactId === fact.id}
                isCorrecting={correctingFactId === fact.id}
                correctionText={correctionText}
                onCorrectionTextChange={setCorrectionText}
                onInspect={() => onInspectFact(fact.id)}
                onConfirm={() => handleConfirm(fact.id)}
                onDismiss={() => handleDismiss(fact.id)}
                onStartCorrect={() => {
                  setCorrectingFactId(fact.id);
                  setCorrectionText(fact.factText);
                }}
                onCancelCorrect={() => {
                  setCorrectingFactId(null);
                  setCorrectionText('');
                }}
                onSubmitCorrect={() => handleSubmitCorrection(fact.id)}
              />
            ))}
          </div>
        </div>
      ))}

      {uncertainFacts.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-mono uppercase tracking-wider text-amber-500 dark:text-amber-400 px-1">
            Needs Confirmation ({uncertainFacts.length})
          </h4>
          <div className="space-y-2">
            {uncertainFacts.map((fact) => (
              <FactRow
                key={fact.id}
                fact={fact}
                isUncertain
                isBusy={busyFactId === fact.id}
                isCorrecting={correctingFactId === fact.id}
                correctionText={correctionText}
                onCorrectionTextChange={setCorrectionText}
                onInspect={() => onInspectFact(fact.id)}
                onConfirm={() => handleConfirm(fact.id)}
                onDismiss={() => handleDismiss(fact.id)}
                onStartCorrect={() => {
                  setCorrectingFactId(fact.id);
                  setCorrectionText(fact.factText);
                }}
                onCancelCorrect={() => {
                  setCorrectingFactId(null);
                  setCorrectionText('');
                }}
                onSubmitCorrect={() => handleSubmitCorrection(fact.id)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

const SectionHeading: React.FC = () => (
  <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 px-1">
    <span className="material-symbols-outlined text-indigo-500 dark:text-indigo-400 text-xl">psychology</span>
    Your Personal Model
  </h3>
);

interface FactRowProps {
  fact: PersonalModelFactDto;
  isUncertain: boolean;
  isBusy: boolean;
  isCorrecting: boolean;
  correctionText: string;
  onCorrectionTextChange: (text: string) => void;
  onInspect: () => void;
  onConfirm: () => void;
  onDismiss: () => void;
  onStartCorrect: () => void;
  onCancelCorrect: () => void;
  onSubmitCorrect: () => void;
}

const FactRow: React.FC<FactRowProps> = ({
  fact,
  isUncertain,
  isBusy,
  isCorrecting,
  correctionText,
  onCorrectionTextChange,
  onInspect,
  onConfirm,
  onDismiss,
  onStartCorrect,
  onCancelCorrect,
  onSubmitCorrect,
}) => {
  const temporalBadge = TEMPORAL_BADGE[fact.temporalState];

  return (
    <div className="liquid-glass rounded-2xl p-3.5 border border-white/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-900 dark:text-white">{fact.factText}</p>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {isUncertain && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 uppercase tracking-wider">
                Unconfirmed
              </span>
            )}
            {temporalBadge && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-500/10 border border-slate-500/30 text-slate-400 uppercase tracking-wider">
                {temporalBadge}
              </span>
            )}
            <button onClick={onInspect} className="text-[10px] font-mono text-indigo-400 hover:underline">
              why?
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onConfirm}
            disabled={isBusy}
            title="Confirm this is right"
            className="w-7 h-7 rounded-full flex items-center justify-center text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40"
          >
            <span className="material-symbols-outlined text-[16px]">check</span>
          </button>
          <button
            onClick={onStartCorrect}
            disabled={isBusy}
            title="Correct this"
            className="w-7 h-7 rounded-full flex items-center justify-center text-indigo-400 hover:bg-indigo-500/10 disabled:opacity-40"
          >
            <span className="material-symbols-outlined text-[16px]">edit</span>
          </button>
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

      {isCorrecting && (
        <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-2">
          <input
            autoFocus
            type="text"
            value={correctionText}
            onChange={(e) => onCorrectionTextChange(e.target.value)}
            className="flex-1 bg-transparent border border-white/15 rounded-full px-3 py-1.5 text-xs text-slate-900 dark:text-white outline-none focus:border-indigo-400/50"
            placeholder="What should this say instead?"
          />
          <button
            onClick={onSubmitCorrect}
            disabled={isBusy || !correctionText.trim()}
            className="text-xs font-mono px-3 py-1.5 rounded-full bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 disabled:opacity-40"
          >
            Save
          </button>
          <button onClick={onCancelCorrect} className="text-xs font-mono px-2 py-1.5 text-slate-400 hover:text-white">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
};
