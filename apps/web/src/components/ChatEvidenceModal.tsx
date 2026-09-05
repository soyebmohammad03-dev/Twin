import React from 'react';
import type { SupportLevel } from '@twin/contracts';
import { ChatMessage, MemoryItem } from '../types';
import { toMemoryItem } from '../services/memoryMapper';
import { INTENT_LABEL, TIER_COLOR, TIER_LABEL, toMinimalMemoryDetail } from './ContextPreviewModal';

interface ChatEvidenceModalProps {
  /** The assistant message being inspected. null closes the modal. */
  message: ChatMessage | null;
  onClose: () => void;
  onSelectMemory: (mem: MemoryItem) => void;
  onSelectEntity: (entityId: string) => void;
  onSelectFact: (factId: string) => void;
  onSelectInsight: (insightId: string) => void;
}

const SUPPORT_LEVEL_LABEL: Record<SupportLevel, string> = {
  directly_supported: 'Directly supported',
  partially_supported: 'Partially supported',
  inferred: 'Inferred',
  insufficient_evidence: 'Insufficient evidence',
};

const SUPPORT_LEVEL_COLOR: Record<SupportLevel, string> = {
  directly_supported: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  partially_supported: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  inferred: 'text-indigo-400 border-indigo-500/30 bg-indigo-500/10',
  insufficient_evidence: 'text-slate-400 border-slate-500/30 bg-slate-500/10',
};

/** category/temporalState/statusClass values are snake_case enum members — this is presentation-only, not a re-derivation of anything. */
function humanizeEnum(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Phase 20's "Why does Twin think this?" for Twin Chat — a structural
 * sibling of ContextPreviewModal/FactEvidenceModal/InsightEvidenceModal.
 * Unlike those, this never fetches anything: every field it renders was
 * already embedded in the chat response's `evidence` (see
 * chatService.ts's buildChatEvidence on the backend), itself a
 * projection of the exact ContextPacket the answer was grounded in.
 * There is no LLM call in this component, and no chain-of-thought is
 * ever shown — only the citation-validated evidence and Twin's own
 * caveats/uncertainty note.
 */
export const ChatEvidenceModal: React.FC<ChatEvidenceModalProps> = ({
  message,
  onClose,
  onSelectMemory,
  onSelectEntity,
  onSelectFact,
  onSelectInsight,
}) => {
  if (!message) return null;
  const evidence = message.evidence;
  const hasAnyEvidence =
    !!evidence && (evidence.memories.length > 0 || evidence.entities.length > 0 || evidence.personalModelFacts.length > 0 || evidence.insights.length > 0);

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
      <div className="liquid-glass-heavy rounded-3xl w-full max-w-lg p-5 sm:p-6 border border-white/15 shadow-2xl relative overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-indigo-400 text-xl">neurology</span>
            <span className="font-mono text-xs text-indigo-400 uppercase tracking-widest">Why Twin thinks this</span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        <div className="space-y-5 my-4">
          <div className="flex flex-wrap items-center gap-2">
            {message.supportLevel && (
              <span className={`text-xs font-mono px-2.5 py-0.5 rounded-full border uppercase tracking-wider ${SUPPORT_LEVEL_COLOR[message.supportLevel]}`}>
                {SUPPORT_LEVEL_LABEL[message.supportLevel]}
              </span>
            )}
            {typeof message.confidence === 'number' && (
              <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-slate-300">
                Confidence {(message.confidence * 100).toFixed(0)}%
              </span>
            )}
            {message.intent && (
              <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 uppercase tracking-wider">
                {INTENT_LABEL[message.intent]}
              </span>
            )}
          </div>

          {message.uncertaintyNote && (
            <div className="liquid-glass rounded-2xl p-3 border border-amber-500/30 bg-amber-500/5">
              <div className="flex items-center gap-1.5 text-amber-400 text-xs font-mono uppercase tracking-wider">
                <span className="material-symbols-outlined text-[16px]">info</span>
                <span>Uncertainty</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{message.uncertaintyNote}</p>
            </div>
          )}

          {message.caveats && message.caveats.length > 0 && (
            <div>
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-2">Caveats</h3>
              <ul className="space-y-1">
                {message.caveats.map((c, i) => (
                  <li key={i} className="text-xs text-slate-500 dark:text-slate-400 flex gap-1.5">
                    <span className="text-slate-600">•</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!hasAnyEvidence && (
            <p className="text-xs text-slate-500 font-mono">
              This answer wasn't grounded in any specific memory, fact, or insight from your vault.
            </p>
          )}

          {evidence && evidence.memories.length > 0 && (
            <div>
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-2">
                Supporting memories ({evidence.memories.length})
              </h3>
              <div className="space-y-2">
                {evidence.memories.map((m) => (
                  <div
                    key={m.memoryId}
                    onClick={() => onSelectMemory(toMemoryItem(toMinimalMemoryDetail(m, evidence.entities)))}
                    className="liquid-glass rounded-2xl p-3 border border-white/10 hover:border-indigo-400/40 cursor-pointer transition-all"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${TIER_COLOR[m.epistemicTier]}`}>
                        {TIER_LABEL[m.epistemicTier]}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {new Date(m.occurredAt ?? m.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 dark:text-[#c7c4d6] line-clamp-3">{m.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {evidence && evidence.entities.length > 0 && (
            <div>
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-2">
                Entities ({evidence.entities.length})
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {evidence.entities.map((e) => (
                  <button
                    key={e.entityId}
                    onClick={() => onSelectEntity(e.entityId)}
                    className="text-[11px] font-mono px-2 py-1 rounded-full bg-white/5 border border-white/10 text-slate-300 hover:border-indigo-400/40 hover:text-indigo-400 transition-colors"
                    title={e.entityType}
                  >
                    {e.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {evidence && evidence.personalModelFacts.length > 0 && (
            <div>
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-2">
                Personal Model facts ({evidence.personalModelFacts.length})
              </h3>
              <div className="space-y-2">
                {evidence.personalModelFacts.map((f) => (
                  <button
                    key={f.factId}
                    onClick={() => onSelectFact(f.factId)}
                    className="w-full text-left liquid-glass rounded-2xl p-3 border border-white/10 hover:border-indigo-400/40 transition-all"
                  >
                    <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-1">
                      <span>{humanizeEnum(f.category)}</span>
                      <span>·</span>
                      <span>{humanizeEnum(f.temporalState)}</span>
                    </div>
                    <p className="text-xs text-slate-700 dark:text-[#c7c4d6]">{f.factText}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {evidence && evidence.insights.length > 0 && (
            <div>
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-2">
                Insights ({evidence.insights.length})
              </h3>
              <div className="space-y-2">
                {evidence.insights.map((i) => (
                  <button
                    key={i.insightId}
                    onClick={() => onSelectInsight(i.insightId)}
                    className="w-full text-left liquid-glass rounded-2xl p-3 border border-white/10 hover:border-indigo-400/40 transition-all"
                  >
                    <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-1">
                      <span>{humanizeEnum(i.statusClass)}</span>
                    </div>
                    <p className="text-xs font-semibold text-slate-800 dark:text-white">{i.title}</p>
                    <p className="text-xs text-slate-600 dark:text-[#c7c4d6] mt-0.5">{i.description}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
