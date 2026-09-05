import React, { useState } from 'react';
import type { EntityDto, EntityType } from '@twin/contracts';
import { entityApi } from '../services/memoryApi';
import { ApiError } from '../services/apiClient';
import { ENTITY_TYPE_ICON } from '../services/graphMapper';

interface CreateEntityModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called once the entity exists — either genuinely new or an existing exact-name match Twin reused instead of duplicating. */
  onCreated: (entity: EntityDto, wasCreated: boolean) => void;
}

/**
 * Phase 34 — the intentional "I already know this should exist in
 * Twin" creation flow the app was missing (Explore could only ever
 * show entities that arrived via memory capture/extraction). Reuses
 * POST /entities exactly as extraction and Phase 33's manual-creation
 * fix do — the same entity-resolution rules, the same ownership
 * checks, the same subtype-row guarantees — so a manually-declared
 * person/project/goal/decision is a real, first-class entity, not a
 * second parallel creation path.
 *
 * Only person/project/goal/decision are offered: CreateEntityInput has
 * no date field, and event's subtype row requires a NOT NULL startsAt
 * — creating an event here would mean either fabricating a date or
 * leaving the entity silently incomplete, so it's deliberately left
 * out rather than faked (see Phase 33's report and
 * entities.service.ts's createSubtypeRowIfApplicable). Decision gets
 * only name/description here too — the richer "I've already decided
 * this, here's the outcome" flow stays exactly where it already lives
 * (Profile → Decisions → Record a decision), not duplicated.
 */
const CREATABLE_TYPES: { type: EntityType; label: string; hint: string }[] = [
  { type: 'person', label: 'Person', hint: 'Someone you know' },
  { type: 'project', label: 'Project', hint: 'Something you’re building' },
  { type: 'goal', label: 'Goal', hint: 'Something you’re working toward' },
  { type: 'decision', label: 'Decision', hint: 'Something to track and decide' },
];

export const CreateEntityModal: React.FC<CreateEntityModalProps> = ({ isOpen, onClose, onCreated }) => {
  const [entityType, setEntityType] = useState<EntityType | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateNotice, setDuplicateNotice] = useState<EntityDto | null>(null);

  function reset() {
    setEntityType(null);
    setName('');
    setDescription('');
    setError(null);
    setDuplicateNotice(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!entityType || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const { entity, wasCreated } = await entityApi.create({
        entityType,
        name: name.trim(),
        description: description.trim() || undefined,
      });
      if (!wasCreated) {
        // Twin's entity resolution found this already exists — never
        // silently create a duplicate. Show that plainly, then hand off
        // to the real existing entity, same as if it had been created.
        setDuplicateNotice(entity);
        window.setTimeout(() => {
          onCreated(entity, false);
          reset();
        }, 1400);
        return;
      }
      onCreated(entity, true);
      reset();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create this entity right now.");
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
      <form
        onSubmit={handleSubmit}
        className="liquid-glass-heavy rounded-3xl w-full max-w-lg p-5 sm:p-6 border border-white/15 shadow-2xl relative overflow-hidden max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-indigo-400 text-xl">add_circle</span>
            <span className="font-mono text-xs text-indigo-400 uppercase tracking-widest">Add to your knowledge graph</span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {duplicateNotice ? (
          <div className="my-6 flex flex-col items-center text-center gap-2 py-6">
            <span className="material-symbols-outlined text-3xl text-amber-400">info</span>
            <p className="text-sm text-slate-700 dark:text-white">
              You already have a {duplicateNotice.entityType} named &ldquo;{duplicateNotice.name}&rdquo;.
            </p>
            <p className="text-xs text-slate-500 font-mono">Opening the existing one instead of creating a duplicate&hellip;</p>
          </div>
        ) : (
          <div className="space-y-4 my-4">
            <div className="space-y-1.5">
              <label className="text-xs font-mono uppercase tracking-wider text-slate-400">
                What are you adding? <span className="text-rose-400">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {CREATABLE_TYPES.map((t) => (
                  <button
                    key={t.type}
                    type="button"
                    onClick={() => setEntityType(t.type)}
                    className={`flex items-center gap-2.5 p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                      entityType === t.type
                        ? 'bg-indigo-500/15 dark:bg-indigo-500/20 border-indigo-500/50'
                        : 'bg-white/5 border-white/10 hover:border-indigo-400/30'
                    }`}
                  >
                    <span
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                        entityType === t.type ? 'bg-indigo-500/25' : 'bg-white/5'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[18px] text-indigo-500 dark:text-indigo-400">
                        {ENTITY_TYPE_ICON[t.type]}
                      </span>
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-900 dark:text-white">{t.label}</span>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">{t.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {entityType && (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-mono uppercase tracking-wider text-slate-400">
                    Name <span className="text-rose-400">*</span>
                  </label>
                  <input
                    autoFocus
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={
                      entityType === 'person'
                        ? 'e.g. Priya Nair'
                        : entityType === 'project'
                          ? 'e.g. Twin'
                          : entityType === 'goal'
                            ? 'e.g. Ship the retrieval upgrade'
                            : 'e.g. Choose remote-first role'
                    }
                    maxLength={200}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-500 outline-none focus:border-indigo-400/50"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-mono uppercase tracking-wider text-slate-400">Description (optional)</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Any context worth recording alongside it"
                    rows={2}
                    maxLength={2000}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-500 outline-none focus:border-indigo-400/50 resize-none"
                  />
                </div>
              </>
            )}

            {error && <p className="text-xs font-mono text-red-400">{error}</p>}
          </div>
        )}

        {!duplicateNotice && (
          <div className="pt-3 border-t border-white/10 flex justify-end gap-2">
            <button type="button" onClick={handleClose} className="px-4 py-2 rounded-full text-xs font-mono text-slate-400 hover:text-white">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!entityType || !name.trim() || saving}
              className="px-5 py-2 rounded-full bg-[#4f4ccd] dark:bg-[#c2c1ff] text-white dark:text-[#1c0b9f] text-xs font-semibold hover:opacity-90 transition-all shadow-md active:scale-95 disabled:opacity-50"
            >
              {saving ? 'Adding…' : 'Add to Twin'}
            </button>
          </div>
        )}
      </form>
    </div>
  );
};
