import React, { useState } from 'react';
import type { ConnectedRelationshipDto, EntityDto } from '@twin/contracts';
import { entityApi } from '../services/memoryApi';
import { graphApi } from '../services/graphApi';
import { ApiError } from '../services/apiClient';

interface ConnectEntityModalProps {
  isOpen: boolean;
  /** The entity this connection is FROM — the one whose detail view this was opened from. */
  fromEntityId: string;
  fromEntityName: string;
  onClose: () => void;
  onConnected: (result: ConnectedRelationshipDto) => void;
}

/**
 * Phase 27's "Connect" flow: Entity → search an EXISTING entity →
 * choose a relationship type → confirm. Deliberately cannot create a
 * new entity from here — only entityApi.list results (the user's real,
 * already-existing entities) are selectable, so this can never
 * silently grow a ghost entity into the graph. relationshipType stays
 * free-text/open-vocabulary (snake_case, validated server-side too) —
 * no rigid enum, matching entity_relationships.relationship_type's
 * existing design.
 */
export const ConnectEntityModal: React.FC<ConnectEntityModalProps> = ({ isOpen, fromEntityId, fromEntityName, onClose, onConnected }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EntityDto[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<EntityDto | null>(null);
  const [relationshipType, setRelationshipType] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setQuery('');
    setResults(null);
    setSelected(null);
    setRelationshipType('');
    setError(null);
  }

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const rows = await entityApi.list({ name: query.trim() });
      setResults(rows.filter((r) => r.id !== fromEntityId));
    } catch {
      setError("Couldn't search your entities right now.");
    } finally {
      setSearching(false);
    }
  }

  async function confirm() {
    if (!selected || !relationshipType.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const result = await graphApi.createRelationship(fromEntityId, {
        toEntityId: selected.id,
        relationshipType: relationshipType.trim(),
      });
      reset();
      onConnected(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create this connection right now.");
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
      <div className="liquid-glass-heavy rounded-3xl w-full max-w-md p-5 sm:p-6 border border-white/15 shadow-2xl relative overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-indigo-400 text-xl">hub</span>
            <span className="font-mono text-xs text-indigo-400 uppercase tracking-widest">Connect</span>
          </div>
          <button
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
          {!selected ? (
            <div className="space-y-2">
              <label className="text-xs font-mono uppercase tracking-wider text-slate-400">Connect "{fromEntityName}" to…</label>
              <div className="flex gap-1.5">
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && search()}
                  placeholder="Search your people, projects, goals…"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-indigo-400/50"
                />
                <button
                  type="button"
                  onClick={search}
                  disabled={!query.trim() || searching}
                  className="px-3 py-2 rounded-lg bg-indigo-500/20 text-indigo-300 text-xs font-mono hover:bg-indigo-500/30 disabled:opacity-50"
                >
                  {searching ? '…' : 'Search'}
                </button>
              </div>
              {results && results.length === 0 && <p className="text-xs text-slate-500 font-mono">No matching entities found.</p>}
              {results && results.length > 0 && (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {results.map((entity) => (
                    <button
                      key={entity.id}
                      onClick={() => setSelected(entity)}
                      className="w-full text-left liquid-glass rounded-xl p-2.5 border border-white/10 hover:border-indigo-400/40 transition-all flex items-center justify-between gap-2"
                    >
                      <span className="text-sm text-slate-800 dark:text-white truncate">{entity.name}</span>
                      <span className="text-[10px] font-mono text-slate-500 uppercase shrink-0">{entity.entityType}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="liquid-glass rounded-xl p-3 border border-indigo-400/30 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-mono text-slate-500">{fromEntityName}</p>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">→ {selected.name}</p>
                </div>
                <button type="button" onClick={() => setSelected(null)} className="shrink-0 text-xs font-mono text-slate-400 hover:text-white">
                  Change
                </button>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-mono uppercase tracking-wider text-slate-400">Relationship type</label>
                <input
                  autoFocus
                  type="text"
                  value={relationshipType}
                  onChange={(e) => setRelationshipType(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                  placeholder="e.g. related_to, works_with, blocks"
                  maxLength={100}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-indigo-400/50"
                />
                <p className="text-[11px] text-slate-500">Lowercase words separated by underscores.</p>
              </div>

              {relationshipType.trim() && (
                <p className="text-xs text-slate-500 font-mono">
                  This will create: <span className="text-slate-300">{fromEntityName}</span> →{' '}
                  <span className="text-indigo-400">{relationshipType.trim()}</span> →{' '}
                  <span className="text-slate-300">{selected.name}</span>
                </p>
              )}
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
          {selected && (
            <button
              type="button"
              disabled={!relationshipType.trim() || saving}
              onClick={confirm}
              className="px-5 py-2 rounded-full bg-[#4f4ccd] dark:bg-[#c2c1ff] text-white dark:text-[#1c0b9f] text-xs font-semibold hover:opacity-90 transition-all shadow-md active:scale-95 disabled:opacity-50"
            >
              {saving ? 'Connecting…' : 'Confirm connection'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
