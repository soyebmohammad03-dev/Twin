import React from 'react';
import { MemoryItem } from '../types';

interface MemoryDetailModalProps {
  memory: MemoryItem | null;
  onClose: () => void;
  onDiscussWithTwin: (mem: MemoryItem) => void;
  onDeleteMemory: (id: string) => void;
  /** Phase 7: opens the real knowledge-graph detail panel for the memory's linked entity, when one exists. */
  onOpenEntity?: (entityId: string) => void;
}

export const MemoryDetailModal: React.FC<MemoryDetailModalProps> = ({
  memory,
  onClose,
  onDiscussWithTwin,
  onDeleteMemory,
  onOpenEntity,
}) => {
  if (!memory) return null;

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

          {/* Description */}
          <div className="liquid-glass rounded-2xl p-4 border border-white/10">
            <p className="text-sm sm:text-base text-slate-700 dark:text-[#c7c4d6] leading-relaxed">
              {memory.description}
            </p>
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
