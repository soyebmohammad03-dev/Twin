import React, { useCallback, useEffect, useState } from 'react';
import { ingestionApi } from '../services/ingestionApi';
import { toIngestionActivityItem } from '../services/ingestionActivity';
import type { IngestionActivityItem } from '../services/ingestionActivity';
import { toMemoryItem } from '../services/memoryMapper';
import { MemoryItem } from '../types';

interface IngestionActivitySectionProps {
  onSelectMemory: (mem: MemoryItem) => void;
}

const STATUS_LABEL: Record<IngestionActivityItem['status'], string> = {
  completed: 'Completed',
  failed: 'Failed',
  processing: 'Processing',
  pending: 'Pending',
};

/**
 * Phase 22 — real ingestion activity, replacing the previous "Active
 * Background Threads" mock (fabricated "Processing 4 documents" /
 * "Monitoring flight prices" scenarios). Reuses GET /ingestion — an
 * already-built, already-tested endpoint the frontend never called —
 * exactly the same reuse-only pattern PersonalModelSection and
 * InsightsSection already establish for this screen: self-contained
 * fetch on mount, no App.tsx state threading.
 */
export const IngestionActivitySection: React.FC<IngestionActivitySectionProps> = ({ onSelectMemory }) => {
  const [items, setItems] = useState<IngestionActivityItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const jobs = await ingestionApi.list();
      setItems(jobs.map(toIngestionActivityItem));
    } catch {
      setError("Couldn't load your recent activity right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleOpenMemory(jobId: string) {
    setBusyJobId(jobId);
    try {
      const result = await ingestionApi.get(jobId);
      if (result.memory) onSelectMemory(toMemoryItem(result.memory));
    } catch {
      // The row simply stays clickable — a transient failure to open the
      // detail view isn't worth a whole-section error state.
    } finally {
      setBusyJobId(null);
    }
  }

  if (loading) {
    return (
      <section className="space-y-3">
        <SectionHeading />
        <div className="flex items-center justify-center py-10 text-xs font-mono text-slate-400">Loading activity…</div>
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

  const allItems = items ?? [];

  return (
    <section className="space-y-3">
      <SectionHeading />

      {allItems.length === 0 && (
        <div className="liquid-glass rounded-3xl p-6 border border-slate-200/80 dark:border-white/10 text-center">
          <p className="text-sm text-slate-600 dark:text-[#c7c4d6]">Nothing captured yet.</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Every note, voice memo, or link you capture will show up here with its real status.
          </p>
        </div>
      )}

      {allItems.length > 0 && (
        <div className="space-y-2.5">
          {allItems.map((item) => (
            <div
              key={item.id}
              onClick={() => item.canViewMemory && handleOpenMemory(item.id)}
              className={`liquid-glass rounded-2xl p-4 flex items-center justify-between gap-3 border border-slate-200/80 dark:border-white/10 transition-all ${
                item.canViewMemory ? 'hover:border-indigo-400/40 cursor-pointer' : 'opacity-80'
              } ${busyJobId === item.id ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border"
                  style={{ backgroundColor: `${item.color}15`, borderColor: `${item.color}40`, color: item.color }}
                >
                  <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white truncate">{item.title}</h4>
                    <span
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded border uppercase tracking-wider shrink-0"
                      style={{ color: item.color, borderColor: `${item.color}40`, backgroundColor: `${item.color}15` }}
                    >
                      {STATUS_LABEL[item.status]}
                    </span>
                  </div>
                  <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5 truncate">{item.subtitle}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] font-mono text-slate-400 hidden sm:inline">{item.timestamp}</span>
                {item.canViewMemory && <span className="material-symbols-outlined text-slate-400 text-lg">chevron_right</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

const SectionHeading: React.FC = () => (
  <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 px-1">
    <span className="material-symbols-outlined text-indigo-500 dark:text-indigo-400 text-xl">workspaces</span>
    Recent Activity
  </h3>
);
