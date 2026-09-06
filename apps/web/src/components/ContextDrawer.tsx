import React from 'react';
import { MemoryItem } from '../types';
import { useEscapeToClose } from '../hooks/useEscapeToClose';

interface ContextDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  memories: MemoryItem[];
  activeMemoryIds: string[];
  onToggleMemoryActive: (id: string) => void;
}

export const ContextDrawer: React.FC<ContextDrawerProps> = ({
  isOpen,
  onClose,
  memories,
  activeMemoryIds,
  onToggleMemoryActive,
}) => {
  useEscapeToClose(onClose, isOpen);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="liquid-glass-heavy w-full max-w-md h-full p-5 sm:p-6 border-l border-white/15 shadow-2xl flex flex-col justify-between overflow-y-auto">
        <div>
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                <span className="material-symbols-outlined text-[18px]">memory</span>
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Active Reasoning Context
                </h3>
                <p className="text-xs font-mono text-slate-400">
                  {activeMemoryIds.length} memories feeding Twin
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10"
              aria-label="Close"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>

          <p className="text-xs text-slate-400 mt-3 leading-relaxed">
            Twin autonomously pulls relevant context into working memory based on semantic similarity.
            Toggle items to test alternative reasoning perspectives.
          </p>

          {/* Active items list */}
          <div className="space-y-3 mt-4">
            {memories.map((mem) => {
              const isActive = activeMemoryIds.includes(mem.id);
              return (
                <div
                  key={mem.id}
                  onClick={() => onToggleMemoryActive(mem.id)}
                  className={`rounded-2xl p-3.5 border transition-all cursor-pointer ${
                    isActive
                      ? 'liquid-glass border-indigo-500/50 shadow-md bg-indigo-500/10'
                      : 'opacity-50 hover:opacity-80 border-white/5 bg-white/5'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] text-indigo-400 uppercase tracking-wider">
                      {mem.category} • {mem.date}
                    </span>
                    <span
                      className={`w-4 h-4 rounded-full border flex items-center justify-center text-[10px] ${
                        isActive
                          ? 'bg-indigo-500 border-indigo-400 text-white'
                          : 'border-slate-500'
                      }`}
                    >
                      {isActive && '✓'}
                    </span>
                  </div>

                  <h4 className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white mt-1">
                    {mem.title}
                  </h4>
                  <p className="text-xs text-slate-400 line-clamp-2 mt-1">
                    {mem.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="pt-4 border-t border-white/10 flex justify-end">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-full bg-[#4f4ccd] dark:bg-[#c2c1ff] text-white dark:text-[#1c0b9f] text-xs font-semibold hover:opacity-90"
          >
            Apply Active Context
          </button>
        </div>
      </div>
    </div>
  );
};
