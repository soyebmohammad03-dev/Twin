import React, { useState } from 'react';
import type { RetrievedMemoryDto } from '@twin/contracts';
import { memoryApi } from '../services/memoryApi';
import { searchApi } from '../services/searchApi';

interface ConnectMemoryPanelProps {
  entityId: string;
  onLinked: () => void | Promise<void>;
}

/**
 * Phase 27: extracted from DecisionDetailModal's Phase 26 inline
 * connect-a-memory block so EntityDetailModal can offer the identical
 * capability — connecting an existing memory to an existing entity via
 * the existing hybrid search (searchApi, same as SearchModal) and the
 * existing POST /memories/:id/entities link endpoint. No new
 * relationship schema, no new evidence system.
 *
 * Deliberately labeled "linked memory," never "supporting evidence" —
 * a memory_entities link (role='related') only records that a memory
 * mentions this entity, not that it evidences any specific claim. That
 * word is reserved for relationship_evidence, a different table with a
 * different meaning (see EntityDetailModal's per-relationship "Why?"
 * panel, which IS real evidence).
 */
export const ConnectMemoryPanel: React.FC<ConnectMemoryPanelProps> = ({ entityId, onLinked }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RetrievedMemoryDto[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [linkingMemoryId, setLinkingMemoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const result = await searchApi.search({ query: query.trim(), limit: 8 });
      setResults(result.results);
    } catch {
      setError("Couldn't search your memories right now.");
    } finally {
      setSearching(false);
    }
  }

  async function link(memoryId: string) {
    setLinkingMemoryId(memoryId);
    setError(null);
    try {
      await memoryApi.linkEntity(memoryId, entityId, 'related');
      setResults((prev) => prev?.filter((r) => r.memory.id !== memoryId) ?? null);
      await onLinked();
    } catch {
      setError("Couldn't link that memory right now.");
    } finally {
      setLinkingMemoryId(null);
    }
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="mt-2 text-xs font-mono text-indigo-400 hover:underline flex items-center gap-1"
      >
        <span className="material-symbols-outlined text-[14px]">link</span>
        Link an existing memory
      </button>
    );
  }

  return (
    <div className="mt-2 liquid-glass rounded-2xl p-3 border border-white/10 space-y-2">
      <div className="flex gap-1.5">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="Search your memories…"
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500 outline-none"
        />
        <button
          type="button"
          onClick={search}
          disabled={!query.trim() || searching}
          className="px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-300 text-xs font-mono hover:bg-indigo-500/30 disabled:opacity-50"
        >
          {searching ? '…' : 'Search'}
        </button>
      </div>
      {error && <p className="text-xs font-mono text-red-400">{error}</p>}
      {results && results.length === 0 && <p className="text-xs text-slate-500 font-mono">No matching memories found.</p>}
      {results && results.length > 0 && (
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {results.map((r) => (
            <div key={r.memory.id} className="flex items-center justify-between gap-2 bg-white/5 rounded-lg p-2">
              <p className="text-xs text-slate-300 line-clamp-2 flex-1">{r.memory.content}</p>
              <button
                type="button"
                disabled={linkingMemoryId === r.memory.id}
                onClick={() => link(r.memory.id)}
                className="shrink-0 text-[10px] font-mono px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
              >
                {linkingMemoryId === r.memory.id ? 'Linking…' : 'Link'}
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => setIsOpen(false)} className="text-[11px] font-mono text-slate-500 hover:text-slate-300">
        Done
      </button>
    </div>
  );
};
