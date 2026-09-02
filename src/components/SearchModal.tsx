import React, { useState, useMemo } from 'react';
import { MemoryItem, TabType } from '../types';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  memories: MemoryItem[];
  onSelectMemory: (mem: MemoryItem) => void;
  onSelectTab: (tab: TabType) => void;
  onAskTwin: (prompt: string) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  memories,
  onSelectMemory,
  onSelectTab,
  onAskTwin,
}) => {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase().trim();
    return memories.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        (m.tags && m.tags.some((t) => t.toLowerCase().includes(q))) ||
        (m.linkedEntity && m.linkedEntity.toLowerCase().includes(q))
    );
  }, [memories, query]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-16 sm:pt-24 bg-black/70 backdrop-blur-md animate-fadeIn">
      <div className="liquid-glass-heavy rounded-3xl w-full max-w-xl p-4 sm:p-5 border border-white/15 shadow-2xl relative overflow-hidden flex flex-col max-h-[80vh]">
        {/* Search Input */}
        <div className="flex items-center gap-3 pb-3 border-b border-white/10">
          <span className="material-symbols-outlined text-indigo-400 text-xl pl-1">
            search
          </span>
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all thoughts, people, decisions, and projects..."
            className="flex-1 bg-transparent border-none outline-none text-slate-900 dark:text-white placeholder:text-slate-400 text-base focus:ring-0"
          />
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        {/* Quick Suggestion Chips */}
        {!query && (
          <div className="py-4 space-y-3">
            <span className="text-xs font-mono text-slate-400 uppercase tracking-wider block">
              Suggested Searches
            </span>
            <div className="flex flex-wrap gap-2">
              {['Sarah Jenkins', 'Project Helios', 'Berlin Relocation', 'Quiet Intelligence', 'House Fund'].map(
                (term) => (
                  <button
                    key={term}
                    onClick={() => setQuery(term)}
                    className="px-3 py-1.5 rounded-full liquid-glass text-xs font-mono text-slate-300 hover:text-white hover:border-indigo-400/40"
                  >
                    {term}
                  </button>
                )
              )}
            </div>
          </div>
        )}

        {/* Results List */}
        {query && (
          <div className="flex-1 overflow-y-auto space-y-2 py-3">
            <div className="flex items-center justify-between text-xs font-mono text-slate-400 px-1">
              <span>{results.length} memories matching</span>
              <button
                onClick={() => {
                  onAskTwin(`Tell me about everything related to "${query}" in my knowledge base.`);
                  onClose();
                }}
                className="text-indigo-400 hover:underline flex items-center gap-1"
              >
                <span>Ask Twin about this</span>
                <span className="material-symbols-outlined text-[13px]">arrow_forward</span>
              </button>
            </div>

            {results.map((mem) => (
              <div
                key={mem.id}
                onClick={() => {
                  onSelectMemory(mem);
                  onClose();
                }}
                className="liquid-glass rounded-2xl p-3.5 hover:border-indigo-400/40 transition-all cursor-pointer border border-white/10 group"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-[10px] text-indigo-400 uppercase tracking-wider">
                    {mem.category} • {mem.date}
                  </span>
                  <span className="material-symbols-outlined text-slate-500 group-hover:text-white text-base">
                    chevron_right
                  </span>
                </div>
                <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {mem.title}
                </h4>
                <p className="text-xs text-slate-400 line-clamp-2 mt-1">{mem.description}</p>
              </div>
            ))}

            {results.length === 0 && (
              <div className="text-center py-8 text-slate-400 text-xs font-mono">
                No stored memories found for "{query}". Try asking Twin to extrapolate.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
