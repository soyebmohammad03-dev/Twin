import React, { useEffect, useRef, useState } from 'react';
import { ChatMessage } from '../types';
import { INITIAL_USER } from '../data/mockData';

interface TwinChatViewProps {
  messages: ChatMessage[];
  onSendMessage: (content: string) => void;
  onRetryMessage: (assistantMessageId: string) => void;
  onOpenContextDrawer: () => void;
  onInspectEvidence: (message: ChatMessage) => void;
}

const QUICK_PROMPTS = [
  'What have I been working on recently?',
  'What do you know about me so far?',
  'What patterns have you noticed?',
];

const SUPPORT_LEVEL_DOT: Record<NonNullable<ChatMessage['supportLevel']>, string> = {
  directly_supported: 'bg-emerald-400',
  partially_supported: 'bg-amber-400',
  inferred: 'bg-indigo-400',
  insufficient_evidence: 'bg-slate-400',
};

/**
 * Phase 20: Twin Chat's real, grounded interface. Every assistant
 * message rendered here is either a live request in flight (`pending`),
 * a failed request (`error`, with retry), or a real GroundedResponse
 * from POST /chat (see App.tsx's handleSendMessage/handleRetryMessage
 * and services/chatApi.ts) — this component never invents a reply, a
 * delay, or a "why" explanation itself; it only renders what the
 * backend returned and hands evidence inspection off to
 * ChatEvidenceModal.
 */
export const TwinChatView: React.FC<TwinChatViewProps> = ({
  messages,
  onSendMessage,
  onRetryMessage,
  onOpenContextDrawer,
  onInspectEvidence,
}) => {
  const [inputText, setInputText] = useState('');
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isSending = messages.some((m) => m.pending);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, messages[messages.length - 1]?.content, messages[messages.length - 1]?.pending]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed || isSending) return;
    onSendMessage(trimmed);
    setInputText('');
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto w-full pb-36 pt-2">
      {/* Twin Emblem Header */}
      <div className="flex flex-col items-center justify-center pt-2">
        <div className="relative w-20 h-20 rounded-full border border-white/20 liquid-glass flex items-center justify-center p-3 shadow-xl twin-core-glow group cursor-pointer">
          <div className="absolute inset-0 rounded-full bg-indigo-500/10 animate-pulse pointer-events-none" />
          <img
            src={INITIAL_USER.twinSymbolUrl}
            alt="Twin Core"
            className="w-full h-full object-contain relative z-10 filter drop-shadow-[0_0_12px_rgba(194,193,255,0.7)] group-hover:scale-105 transition-transform"
          />
        </div>
        <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white mt-2">
          Twin Personal Intelligence
        </h2>
        <p className="text-xs font-mono text-slate-500 dark:text-slate-400">
          Grounded in your memories, connections, and evolving Personal Model
        </p>
      </div>

      {/* Context management affordance */}
      <div className="flex flex-wrap items-center justify-center gap-2 sticky top-16 z-30 py-2">
        <button
          onClick={onOpenContextDrawer}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full liquid-glass text-xs font-mono text-slate-700 dark:text-[#c7c4d6] hover:border-indigo-400/50 transition-all cursor-pointer shadow-sm active:scale-95"
        >
          <span className="material-symbols-outlined text-[15px] text-indigo-400">memory</span>
          <span>Manage context</span>
          <span className="material-symbols-outlined text-[14px] text-slate-400">tune</span>
        </button>
      </div>

      {/* Empty conversation state */}
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <span className="material-symbols-outlined text-3xl text-indigo-400/60">chat_bubble</span>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm">
            Ask Twin about something from your memories, a person, a project, or a decision — or just say hello.
          </p>
        </div>
      )}

      {/* Message Stream */}
      <div className="flex flex-col gap-6">
        {messages.map((msg) => {
          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="self-end max-w-[88%] sm:max-w-[75%] flex flex-col items-end">
                <div className="relative rounded-2xl rounded-tr-xs bg-[#4f4ccd] dark:bg-[#2a2a2b] text-white dark:text-[#e5e2e3] px-5 py-3.5 shadow-lg border border-white/10 overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
                  <p className="text-sm sm:text-base leading-relaxed relative z-10 font-sans whitespace-pre-wrap break-words">
                    {msg.content}
                  </p>
                </div>
                <span className="font-mono text-[10px] text-slate-400 mt-1 pr-1">{msg.timestamp}</span>
              </div>
            );
          }

          const hasEvidence =
            !msg.pending &&
            !msg.error &&
            (!!msg.evidence &&
              (msg.evidence.memories.length > 0 ||
                msg.evidence.entities.length > 0 ||
                msg.evidence.personalModelFacts.length > 0 ||
                msg.evidence.insights.length > 0) ||
              (!!msg.caveats && msg.caveats.length > 0) ||
              !!msg.uncertaintyNote);

          return (
            <div key={msg.id} className="self-start w-full max-w-[92%] sm:max-w-[85%] flex flex-col gap-2">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                  <span className="material-symbols-outlined text-indigo-400 text-sm">smart_toy</span>
                </div>
                <div className="flex-1 min-w-0">
                  {msg.pending && (
                    <div className="flex items-center gap-1.5 py-1.5" role="status" aria-live="polite">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:-0.3s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:-0.15s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" />
                      <span className="text-xs font-mono text-slate-400 ml-1">Twin is thinking…</span>
                    </div>
                  )}

                  {!msg.pending && msg.error && (
                    <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-3">
                      <p className="text-sm text-red-400">{msg.error}</p>
                      {msg.retryable !== false && (
                        <button
                          onClick={() => onRetryMessage(msg.id)}
                          disabled={isSending}
                          className="mt-2 inline-flex items-center gap-1 text-xs font-mono text-indigo-400 hover:text-indigo-300 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <span className="material-symbols-outlined text-[14px]">refresh</span>
                          <span>Retry</span>
                        </button>
                      )}
                    </div>
                  )}

                  {!msg.pending && !msg.error && (
                    <p className="text-sm sm:text-base text-slate-700 dark:text-[#c7c4d6] leading-relaxed whitespace-pre-wrap break-words">
                      {msg.content}
                    </p>
                  )}
                </div>
              </div>

              {!msg.pending && !msg.error && (
                <div className="sm:ml-11 flex items-center gap-3 flex-wrap">
                  <span className="font-mono text-[10px] text-slate-400">{msg.timestamp}</span>
                  {msg.supportLevel && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-500 dark:text-slate-400">
                      <span className={`w-1.5 h-1.5 rounded-full ${SUPPORT_LEVEL_DOT[msg.supportLevel]}`} />
                      {typeof msg.confidence === 'number' ? `${(msg.confidence * 100).toFixed(0)}% confidence` : null}
                    </span>
                  )}
                  {hasEvidence && (
                    <button
                      onClick={() => onInspectEvidence(msg)}
                      className="text-[11px] font-mono text-indigo-400 hover:text-indigo-300 hover:underline flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[13px]">neurology</span>
                      <span>Why does Twin think this?</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Suggested Follow-up Prompts */}
      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2 pt-2">
          <span className="w-full text-xs font-mono text-slate-500 dark:text-slate-400">Try asking:</span>
          {QUICK_PROMPTS.map((prompt, idx) => (
            <button
              key={idx}
              onClick={() => onSendMessage(prompt)}
              disabled={isSending}
              className="px-3 py-1.5 rounded-full liquid-glass text-xs text-slate-700 dark:text-slate-300 hover:border-indigo-400/40 hover:text-indigo-400 transition-all text-left cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              "{prompt}"
            </button>
          ))}
        </div>
      )}

      {/* Floating Composer Bar */}
      <div className="fixed bottom-20 sm:bottom-24 left-0 right-0 px-4 sm:px-6 z-40 max-w-3xl mx-auto pointer-events-none">
        <form
          onSubmit={handleSend}
          className="pointer-events-auto liquid-glass-heavy rounded-3xl p-2 flex items-center gap-2 shadow-2xl transition-all duration-300 focus-within:ring-2 focus-within:ring-indigo-500/40 border border-slate-200/90 dark:border-white/10"
        >
          <button
            type="button"
            onClick={onOpenContextDrawer}
            className="w-10 h-10 rounded-full flex items-center justify-center text-slate-500 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
            title="Inspect or manage active memories"
          >
            <span className="material-symbols-outlined text-[20px]">add</span>
          </button>

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                handleSend(e);
              }
            }}
            disabled={isSending}
            placeholder={isSending ? 'Waiting for Twin…' : 'Ask Twin anything…'}
            className="flex-1 bg-transparent border-none outline-none text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-[#918f9f] text-sm sm:text-base focus:ring-0 px-1 py-2 font-sans disabled:opacity-60"
          />

          <button
            type="button"
            onClick={() => setIsVoiceActive((v) => !v)}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all shrink-0 ${
              isVoiceActive
                ? 'bg-rose-500 text-white animate-pulse'
                : 'text-slate-500 dark:text-slate-300 hover:text-indigo-400 hover:bg-white/10'
            }`}
            title="Voice input (coming soon)"
          >
            <span
              className="material-symbols-outlined text-[20px]"
              style={{ fontVariationSettings: isVoiceActive ? "'FILL' 1" : "'FILL' 0" }}
            >
              mic
            </span>
          </button>

          <button
            type="submit"
            disabled={!inputText.trim() || isSending}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all shrink-0 ${
              inputText.trim() && !isSending
                ? 'bg-[#4f4ccd] dark:bg-[#c2c1ff] text-white dark:text-[#1c0b9f] shadow-md hover:scale-105 active:scale-95'
                : 'bg-white/5 text-slate-400 opacity-30 cursor-not-allowed'
            }`}
            title="Send"
          >
            <span className="material-symbols-outlined text-[19px]">arrow_upward</span>
          </button>
        </form>
      </div>
    </div>
  );
};
