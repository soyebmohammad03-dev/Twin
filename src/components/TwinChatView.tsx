import React, { useState } from 'react';
import { ChatMessage, TwinSuggestion } from '../types';
import { INITIAL_USER } from '../data/mockData';

interface TwinChatViewProps {
  messages: ChatMessage[];
  onSendMessage: (content: string) => void;
  onOpenContextDrawer: () => void;
}

export const TwinChatView: React.FC<TwinChatViewProps> = ({
  messages,
  onSendMessage,
  onOpenContextDrawer,
}) => {
  const [inputText, setInputText] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedWhyFits, setExpandedWhyFits] = useState<Record<string, boolean>>({
    'sug-1': true,
  });
  const [isVoiceActive, setIsVoiceActive] = useState(false);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const copyToClipboard = (sug: TwinSuggestion) => {
    navigator.clipboard?.writeText(sug.text.replace(/^"|"$/g, ''));
    setCopiedId(sug.id);
    setTimeout(() => {
      setCopiedId(null);
    }, 2000);
  };

  const toggleWhyFits = (id: string) => {
    setExpandedWhyFits((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const quickPrompts = [
    'Should I propose an alternative weekend trip?',
    'What did Sarah say about her Patagonia sabbatical?',
    'Review my house savings pace for this month',
  ];

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
          Reasoning with your active goals & relationship memory
        </p>
      </div>

      {/* Contextual Intelligence Chips */}
      <div className="flex flex-wrap items-center justify-center gap-2 sticky top-16 z-30 py-2">
        <button
          onClick={onOpenContextDrawer}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full liquid-glass text-xs font-mono text-slate-700 dark:text-[#c7c4d6] hover:border-indigo-400/50 transition-all cursor-pointer shadow-sm active:scale-95"
        >
          <span className="material-symbols-outlined text-[15px] text-indigo-400 animate-pulse">
            memory
          </span>
          <span>4 memories active</span>
          <span className="material-symbols-outlined text-[14px] text-slate-400">tune</span>
        </button>

        <button
          onClick={onOpenContextDrawer}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full liquid-glass text-xs font-mono text-slate-700 dark:text-[#c7c4d6] hover:border-indigo-400/50 transition-all cursor-pointer shadow-sm active:scale-95"
        >
          <span className="material-symbols-outlined text-[15px] text-violet-400">
            person_search
          </span>
          <span>Sarah context</span>
        </button>

        <button
          onClick={onOpenContextDrawer}
          className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full liquid-glass text-xs font-mono text-emerald-600 dark:text-emerald-400 hover:border-emerald-400/50 transition-all cursor-pointer shadow-sm active:scale-95"
        >
          <span className="material-symbols-outlined text-[15px]">flag</span>
          <span>House fund ($500/mo)</span>
        </button>
      </div>

      {/* Message Stream */}
      <div className="flex flex-col gap-6">
        {messages.map((msg) => {
          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="self-end max-w-[88%] sm:max-w-[75%] flex flex-col items-end">
                <div className="relative rounded-2xl rounded-tr-xs bg-[#4f4ccd] dark:bg-[#2a2a2b] text-white dark:text-[#e5e2e3] px-5 py-3.5 shadow-lg border border-white/10 overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
                  <p className="text-sm sm:text-base leading-relaxed relative z-10 font-sans">
                    {msg.content}
                  </p>
                </div>
                <span className="font-mono text-[10px] text-slate-400 mt-1 pr-1">
                  {msg.timestamp}
                </span>
              </div>
            );
          }

          return (
            <div key={msg.id} className="self-start w-full flex flex-col gap-3">
              {/* Assistant Message Header */}
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                  <span className="material-symbols-outlined text-indigo-400 text-sm">smart_toy</span>
                </div>
                <div className="flex-1">
                  <p className="text-sm sm:text-base text-slate-700 dark:text-[#c7c4d6] leading-relaxed">
                    {msg.content}
                  </p>
                </div>
              </div>

              {/* Suggestions Bento Stack */}
              {msg.suggestions && msg.suggestions.length > 0 && (
                <div className="grid grid-cols-1 gap-3 sm:ml-11 mt-1">
                  {msg.suggestions.map((sug) => {
                    const isCopied = copiedId === sug.id;
                    const isOpen = !!expandedWhyFits[sug.id];

                    return (
                      <div
                        key={sug.id}
                        className="group rounded-2xl liquid-glass p-4 sm:p-5 border border-slate-200/80 dark:border-white/10 hover:border-indigo-400/50 transition-all duration-300 relative overflow-hidden shadow-md"
                      >
                        <div className="specular-highlight absolute inset-0 pointer-events-none opacity-20 rounded-2xl" />
                        <div className="flex flex-col gap-2.5 relative z-10">
                          {/* Tone Header & Copy Button */}
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs uppercase tracking-widest font-semibold flex items-center gap-1.5 text-indigo-600 dark:text-[#c2c1ff]">
                              <span className="material-symbols-outlined text-[15px]">
                                {sug.icon}
                              </span>
                              {sug.label}
                            </span>

                            <button
                              onClick={() => copyToClipboard(sug)}
                              className={`px-2.5 py-1 rounded-full flex items-center gap-1 text-xs font-mono transition-all cursor-pointer ${
                                isCopied
                                  ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40'
                                  : 'bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300 hover:bg-indigo-500/10 dark:hover:bg-indigo-500/20 hover:text-indigo-600 dark:hover:text-indigo-400 border border-slate-200 dark:border-white/10'
                              }`}
                              title="Copy reply text"
                            >
                              <span className="material-symbols-outlined text-[14px]">
                                {isCopied ? 'check' : 'content_copy'}
                              </span>
                              <span>{isCopied ? 'Copied' : 'Copy'}</span>
                            </button>
                          </div>

                          {/* Reply Body */}
                          <p className="text-sm sm:text-base font-normal text-slate-900 dark:text-white leading-relaxed">
                            {sug.text}
                          </p>

                          {/* Expandable "Why this fits" context */}
                          <div className="pt-1 border-t border-slate-200/60 dark:border-white/5">
                            <button
                              type="button"
                              onClick={() => toggleWhyFits(sug.id)}
                              className="font-mono text-xs text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1 select-none transition-colors cursor-pointer py-1"
                            >
                              <span
                                className={`material-symbols-outlined text-[16px] transition-transform duration-200 ${
                                  isOpen ? 'rotate-90 text-indigo-600 dark:text-indigo-400' : ''
                                }`}
                              >
                                chevron_right
                              </span>
                              <span>Why this fits</span>
                            </button>

                            {isOpen && (
                              <div className="pl-5 border-l-2 border-indigo-500/40 mt-1.5 text-xs sm:text-sm text-slate-600 dark:text-[#c7c4d6]/90 leading-relaxed py-1 animate-fadeIn">
                                {sug.whyThisFits}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Suggested Follow-up Prompts */}
      <div className="flex flex-wrap gap-2 pt-2">
        <span className="w-full text-xs font-mono text-slate-500 dark:text-slate-400">
          Suggested follow-ups:
        </span>
        {quickPrompts.map((prompt, idx) => (
          <button
            key={idx}
            onClick={() => onSendMessage(prompt)}
            className="px-3 py-1.5 rounded-full liquid-glass text-xs text-slate-700 dark:text-slate-300 hover:border-indigo-400/40 hover:text-indigo-400 transition-all text-left cursor-pointer"
          >
            "{prompt}"
          </button>
        ))}
      </div>

      {/* Floating Composer Bar */}
      <div className="fixed bottom-20 sm:bottom-24 left-0 right-0 px-4 sm:px-6 z-40 max-w-3xl mx-auto pointer-events-none">
        <form
          onSubmit={handleSend}
          className="pointer-events-auto liquid-glass-heavy rounded-3xl p-2 flex items-center gap-2 shadow-2xl transition-all duration-300 focus-within:ring-2 focus-within:ring-indigo-500/40 border border-slate-200/90 dark:border-white/10"
        >
          {/* Quick Context Add button */}
          <button
            type="button"
            onClick={onOpenContextDrawer}
            className="w-10 h-10 rounded-full flex items-center justify-center text-slate-500 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
            title="Inspect or manage active memories"
          >
            <span className="material-symbols-outlined text-[20px]">add</span>
          </button>

          {/* Text Input */}
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={isVoiceActive ? 'Listening to voice prompt...' : 'Reply to Twin or ask for advice...'}
            className="flex-1 bg-transparent border-none outline-none text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-[#918f9f] text-sm sm:text-base focus:ring-0 px-1 py-2 font-sans"
          />

          {/* Voice Mode Toggle */}
          <button
            type="button"
            onClick={() => {
              setIsVoiceActive(!isVoiceActive);
              if (!isVoiceActive) {
                setTimeout(() => {
                  setInputText('What if Sarah wants to book the flight tonight?');
                  setIsVoiceActive(false);
                }, 1600);
              }
            }}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all shrink-0 ${
              isVoiceActive
                ? 'bg-rose-500 text-white animate-pulse'
                : 'text-slate-500 dark:text-slate-300 hover:text-indigo-400 hover:bg-white/10'
            }`}
            title="Voice input"
          >
            <span
              className="material-symbols-outlined text-[20px]"
              style={{ fontVariationSettings: isVoiceActive ? "'FILL' 1" : "'FILL' 0" }}
            >
              mic
            </span>
          </button>

          {/* Send Button */}
          <button
            type="submit"
            disabled={!inputText.trim()}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all shrink-0 ${
              inputText.trim()
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
