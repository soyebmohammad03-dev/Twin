import React, { useEffect, useMemo, useState } from 'react';
import { MemoryItem, TabType } from '../types';
import { searchApi } from '../services/searchApi';
import { toMemoryItem } from '../services/memoryMapper';
import type { RetrievedMemoryDto } from '@twin/contracts';
import { useEscapeToClose } from '../hooks/useEscapeToClose';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectMemory: (mem: MemoryItem) => void;
  onSelectTab: (tab: TabType) => void;
  onAskTwin: (prompt: string) => void;
  /** Phase 8: opens the Context Engine preview for the current query. */
  onViewContext: (query: string) => void;
}

interface SearchResultRow {
  item: MemoryItem;
  reasons: string[];
}

const SEARCH_DEBOUNCE_MS = 350;

/**
 * Wired to the real Phase 6 hybrid retrieval API (POST /search) —
 * semantic + lexical + entity-aware ranking with evidence, replacing
 * the earlier client-side substring filter over already-loaded
 * memories. The modal shell, suggestion chips, and "Ask Twin about
 * this" affordance are unchanged.
 */
export const SearchModal: React.FC<SearchModalProps> = ({ isOpen, onClose, onSelectMemory, onSelectTab, onAskTwin, onViewContext }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultRow[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setError(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    setError(null);
    let cancelled = false;

    const timer = setTimeout(async () => {
      try {
        const response = await searchApi.search({ query: trimmed, limit: 15 });
        if (cancelled) return;
        setResults(
          response.results.map((r: RetrievedMemoryDto) => ({
            item: toMemoryItem(r.memory),
            reasons: r.matchReasons,
          })),
        );
      } catch {
        if (!cancelled) setError('Search failed. Please try again.');
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const suggestions = useMemo(
    () => ['Sarah Jenkins', 'Project Helios', 'Berlin Relocation', 'Quiet Intelligence', 'House Fund'],
    [],
  );

  useEscapeToClose(onClose, isOpen);
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
            aria-label="Close"
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
              {suggestions.map((term) => (
                <button
                  key={term}
                  onClick={() => setQuery(term)}
                  className="px-3 py-1.5 rounded-full liquid-glass text-xs font-mono text-slate-300 hover:text-white hover:border-indigo-400/40"
                >
                  {term}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Results List */}
        {query && (
          <div className="flex-1 overflow-y-auto space-y-2 py-3">
            <div className="flex items-center justify-between text-xs font-mono text-slate-400 px-1">
              <span>{isSearching ? 'Searching…' : `${results.length} memories matching`}</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => onViewContext(query)}
                  className="text-slate-400 hover:text-white hover:underline flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[13px]">layers</span>
                  <span>View context</span>
                </button>
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
            </div>

            {error && <div className="text-center py-8 text-red-400 text-xs font-mono">{error}</div>}

            {!error &&
              results.map(({ item, reasons }) => (
                <div
                  key={item.id}
                  onClick={() => {
                    onSelectMemory(item);
                    onClose();
                  }}
                  className="liquid-glass rounded-2xl p-3.5 hover:border-indigo-400/40 transition-all cursor-pointer border border-white/10 group"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-[10px] text-indigo-400 uppercase tracking-wider">
                      {item.category} • {item.date}
                    </span>
                    <span className="material-symbols-outlined text-slate-500 group-hover:text-white text-base">
                      chevron_right
                    </span>
                  </div>
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{item.title}</h4>
                  <p className="text-xs text-slate-400 line-clamp-2 mt-1">{item.description}</p>
                  {reasons.length > 0 && (
                    <p className="text-[10px] text-indigo-400/80 font-mono mt-1.5 truncate">
                      why: {reasons.slice(0, 2).join(' · ')}
                    </p>
                  )}
                </div>
              ))}

            {!error && !isSearching && results.length === 0 && (
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
