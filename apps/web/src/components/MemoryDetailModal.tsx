import React, { useEffect, useState } from 'react';
import type { MemoryCorrectionDto } from '@twin/contracts';
import { MemoryItem } from '../types';
import { memoryApi } from '../services/memoryApi';

interface MemoryDetailModalProps {
  memory: MemoryItem | null;
  onClose: () => void;
  onDiscussWithTwin: (mem: MemoryItem) => void;
  onDeleteMemory: (id: string) => void;
  /** Phase 7: opens the real knowledge-graph detail panel for the memory's linked entity, when one exists. */
  onOpenEntity?: (entityId: string) => void;
  /** Phase 38: called after a correction is saved, with the memory's new content — lets the caller patch its own list instead of going stale until remount. */
  onMemoryCorrected?: (id: string, newContent: string) => void;
}

export const MemoryDetailModal: React.FC<MemoryDetailModalProps> = ({
  memory,
  onClose,
  onDiscussWithTwin,
  onDeleteMemory,
  onOpenEntity,
  onMemoryCorrected,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [contentDraft, setContentDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [corrections, setCorrections] = useState<MemoryCorrectionDto[] | null>(null);
  const [correctionsError, setCorrectionsError] = useState<string | null>(null);

  function loadCorrections(id: string) {
    setCorrectionsError(null);
    memoryApi
      .getCorrections(id)
      .then((rows) => setCorrections(rows))
      .catch(() => setCorrectionsError('Could not load correction history.'));
  }

  useEffect(() => {
    setIsEditing(false);
    setCorrections(null);
    setCorrectionsError(null);
    if (memory) {
      setContentDraft(memory.description);
      loadCorrections(memory.id);
    }
  }, [memory?.id]);

  if (!memory) return null;

  async function saveCorrection() {
    if (!memory) return;
    const trimmed = contentDraft.trim();
    if (!trimmed || trimmed === memory.description) {
      setIsEditing(false);
      return;
    }
    setSaving(true);
    try {
      await memoryApi.update(memory.id, { content: trimmed });
      onMemoryCorrected?.(memory.id, trimmed);
      loadCorrections(memory.id);
      setIsEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
      <div className="liquid-glass-heavy rounded-3xl w-full max-w-lg p-5 sm:p-6 border border-white/15 shadow-2xl relative overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-indigo-400 uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20">
              {memory.category}
            </span>
            <span className="font-mono text-xs text-slate-400">{memory.date}</span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 my-4">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
            {memory.title}
          </h2>

          {/* Special Person role badge */}
          {memory.personRole && (
            <div className="flex items-center gap-2 text-xs font-mono text-indigo-400">
              <span className="material-symbols-outlined text-[15px]">badge</span>
              <span>{memory.personRole}</span>
            </div>
          )}

          {/* Full Image Preview if available */}
          {memory.imageUrl && (
            <div className="w-full h-48 sm:h-64 rounded-2xl overflow-hidden border border-white/15 shadow-lg relative">
              <img
                src={memory.imageUrl}
                alt={memory.title}
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* Description — correctable: editing writes a real correction record, never silently overwritten */}
          <div className="liquid-glass rounded-2xl p-4 border border-white/10">
            {!isEditing ? (
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm sm:text-base text-slate-700 dark:text-[#c7c4d6] leading-relaxed">
                  {memory.description}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setContentDraft(memory.description);
                    setIsEditing(true);
                  }}
                  className="shrink-0 text-xs font-mono text-indigo-400 hover:underline"
                >
                  Correct
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <textarea
                  value={contentDraft}
                  onChange={(e) => setContentDraft(e.target.value)}
                  rows={4}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none resize-none"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={saveCorrection}
                    className="px-4 py-1.5 rounded-full bg-[#4f4ccd] dark:bg-[#c2c1ff] text-white dark:text-[#1c0b9f] text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save correction'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="px-4 py-1.5 rounded-full text-xs font-mono text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Correction history — real, immutable prior content, never erased by an edit */}
          <div>
            <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-2">Correction History</h3>
            {correctionsError && <p className="text-xs text-red-400 font-mono">{correctionsError}</p>}
            {!correctionsError && corrections && corrections.length === 0 && (
              <p className="text-xs text-slate-500 font-mono">No corrections recorded yet.</p>
            )}
            {corrections && corrections.length > 0 && (
              <div className="space-y-1.5">
                {corrections.map((c) => (
                  <div key={c.id} className="liquid-glass rounded-xl p-2.5 border border-white/10 text-xs">
                    <div className="text-[10px] font-mono text-slate-500">
                      {new Date(c.changedAt).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </div>
                    <p className="text-slate-500 line-through decoration-slate-500/50 mt-0.5">{c.previousContent}</p>
                    <p className="text-slate-700 dark:text-slate-300 mt-0.5">{c.newContent}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Source & Provenance Metadata */}
          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div className="liquid-glass p-3 rounded-xl border border-white/5">
              <span className="text-slate-400 block text-[10px] uppercase tracking-wider">
                Origin Source
              </span>
              <span className="text-slate-200 mt-1 block font-semibold">{memory.source}</span>
            </div>

            <div className="liquid-glass p-3 rounded-xl border border-white/5">
              <span className="text-slate-400 block text-[10px] uppercase tracking-wider">
                Classification
              </span>
              <span className="text-emerald-400 mt-1 block font-semibold">
                {memory.explicit ? 'Explicit Fact' : 'Inferred Insight'}
              </span>
            </div>
          </div>

          {/* Tags */}
          {memory.tags && memory.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {memory.tags.map((tag, idx) => (
                <span
                  key={idx}
                  className="text-xs font-mono px-2.5 py-1 rounded-md bg-white/5 text-slate-400 border border-white/10"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Linked Entity */}
          {memory.linkedEntity && (
            <button
              onClick={() => memory.linkedEntityId && onOpenEntity?.(memory.linkedEntityId)}
              disabled={!memory.linkedEntityId || !onOpenEntity}
              className="flex items-center gap-2 text-xs font-mono text-indigo-400 pt-1 hover:underline disabled:no-underline disabled:cursor-default text-left"
            >
              <span className="material-symbols-outlined text-[16px]">hub</span>
              <span>Linked in Knowledge Graph: {memory.linkedEntity}</span>
              {memory.linkedEntityId && onOpenEntity && (
                <span className="material-symbols-outlined text-[14px]">chevron_right</span>
              )}
            </button>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-2 pt-3 border-t border-white/10">
            <button
              onClick={() => {
                onDiscussWithTwin(memory);
                onClose();
              }}
              className="flex-1 py-2.5 rounded-full bg-[#4f4ccd] dark:bg-[#c2c1ff] text-white dark:text-[#1c0b9f] text-xs font-semibold hover:opacity-90 flex items-center justify-center gap-1.5 shadow-md active:scale-95"
            >
              <span className="material-symbols-outlined text-[16px]">chat</span>
              <span>Discuss with Twin</span>
            </button>

            <button
              onClick={() => {
                if (confirm(`Delete memory "${memory.title}"?`)) {
                  onDeleteMemory(memory.id);
                  onClose();
                }
              }}
              className="px-4 py-2.5 rounded-full bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 text-xs font-mono flex items-center justify-center gap-1 border border-rose-500/20"
            >
              <span className="material-symbols-outlined text-[16px]">delete</span>
              <span>Delete</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
