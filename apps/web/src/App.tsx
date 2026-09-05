import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  TabType,
  ThemeMode,
  ThemePreference,
  AccountSection,
  MemoryItem,
  ChatMessage,
} from './types';
import type { DecisionDto, EntityDto, InsightDto, RelatedEntitiesResponse } from '@twin/contracts';
import { AppProvider, useApp } from './context/AppContext';
import { memoryApi, entityApi } from './services/memoryApi';
import { graphApi } from './services/graphApi';
import { decisionsApi } from './services/decisionsApi';
import { ingestionApi } from './services/ingestionApi';
import { insightsApi } from './services/insightsApi';
import { chatApi } from './services/chatApi';
import { ApiError } from './services/apiClient';
import { selectTopInsight } from './services/homeInsight';
import { selectExplorationInsights } from './services/exploreInsight';
import { toMemoryItem, toCreateIngestionRequest } from './services/memoryMapper';
import { SplashScreen } from './components/SplashScreen';
import { AuthView } from './components/AuthView';
import { TopAppBar } from './components/TopAppBar';
import { BottomNavBar } from './components/BottomNavBar';
import { HomeView } from './components/HomeView';
import { TwinChatView } from './components/TwinChatView';
import { MemoryView } from './components/MemoryView';
import { ExploreView } from './components/ExploreView';
import { ProfileView } from './components/ProfileView';
import { CaptureModal } from './components/CaptureModal';
import { PrivacyModal } from './components/PrivacyModal';
import { DeepExplorationModal } from './components/DeepExplorationModal';
import { SearchModal } from './components/SearchModal';
import { ContextDrawer } from './components/ContextDrawer';
import { MemoryDetailModal } from './components/MemoryDetailModal';
import { EntityDetailModal } from './components/EntityDetailModal';
import { DecisionDetailModal } from './components/DecisionDetailModal';
import { FactEvidenceModal } from './components/FactEvidenceModal';
import { InsightEvidenceModal } from './components/InsightEvidenceModal';
import { InsightContextModal } from './components/InsightContextModal';
import { ContextPreviewModal } from './components/ContextPreviewModal';
import { ChatEvidenceModal } from './components/ChatEvidenceModal';
import { AccountModal } from './components/AccountModal';

/** Bounded conversation history sent to POST /chat for continuity — recent turns only, never the full transcript (see Phase 20's chatRequestSchema, max 20). */
const CHAT_HISTORY_TURNS = 8;

const formatChatTimestamp = () => new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

const TwinAppInner: React.FC = () => {
  const {
    isAuthenticated,
    isAuthChecking,
    currentUser,
    signOut,
    themePreference,
    setThemePreference,
    resolvedTheme,
    accentColor,
  } = useApp();

  // Startup splash state
  const [hasFinishedSplash, setHasFinishedSplash] = useState(false);

  // Active Tab navigation
  const [currentTab, setCurrentTab] = useState<TabType>('home');

  // Core Data States — memories are now backed by the real Memory API
  // (apps/api/src/modules/memories), not localStorage/mock seed data.
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [isMemoriesLoading, setIsMemoriesLoading] = useState(true);

  // Phase 15/21: the raw insights list Home's single highlight AND
  // Explore's Deep Exploration both select over client-side (see
  // services/homeInsight.ts / services/exploreInsight.ts) — one fetch,
  // two curated views, never a second rebuild trigger. This never calls
  // rebuild() itself, matching the existing "explicit rebuild only,
  // never on every page load" rule (Profile's own visit already keeps
  // this fresh); it just re-reads current state, same as memories below.
  const [allInsights, setAllInsights] = useState<InsightDto[]>([]);
  const [isInsightsLoading, setIsInsightsLoading] = useState(false);
  const topInsight = useMemo(() => selectTopInsight(allInsights), [allInsights]);
  const explorationInsights = useMemo(() => selectExplorationInsights(allInsights), [allInsights]);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem('twin_chat');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
    return [];
  });
  const [inspectingChatMessage, setInspectingChatMessage] = useState<ChatMessage | null>(null);

  // Phase 21: Explore's real Knowledge Graph state. `entities` is the
  // user's full entity list (GET /entities); `relatedNodes` is the
  // bounded traversal (GET /entities/:id/related) for whichever entity
  // is currently focused — the exact same two calls EntityDetailModal
  // already makes, just driving the main graph canvas instead of a
  // drill-down overlay.
  const [entities, setEntities] = useState<EntityDto[]>([]);
  const [isEntitiesLoading, setIsEntitiesLoading] = useState(true);
  const [focusEntityId, setFocusEntityId] = useState<string | null>(null);
  const [relatedResponse, setRelatedResponse] = useState<RelatedEntitiesResponse | null>(null);
  const [isRelatedLoading, setIsRelatedLoading] = useState(false);
  const [activeMemoryIds, setActiveMemoryIds] = useState<string[]>([
    'mem-1',
    'mem-2',
    'mem-3',
    'mem-4',
  ]);

  // Load memories from the real API whenever the signed-in user changes
  // (this component doesn't unmount across a sign-out/sign-in within the
  // same tab, so it must re-fetch — and clear stale state — rather than
  // only loading once on mount, or a second user would briefly see the
  // first user's memories and open modals until a hard refresh).
  useEffect(() => {
    if (!currentUser) {
      setMemories([]);
      setIsMemoriesLoading(false);
      return;
    }
    let cancelled = false;
    setMemories([]);
    setSelectedMemoryDetail(null);
    setSelectedEntityId(null);
    setIsMemoriesLoading(true);
    memoryApi
      .list()
      .then((dtos) => {
        if (cancelled) return;
        setMemories(dtos.map(toMemoryItem));
      })
      .catch((err) => {
        console.error('Failed to load memories:', err);
      })
      .finally(() => {
        if (!cancelled) setIsMemoriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id]);

  // Same pattern as the memories effect above, for Home's single
  // highlighted insight — cleared on sign-out/sign-in so a second user
  // never briefly sees the first user's insight. Also re-reads whenever
  // Home becomes the active tab (not just once at sign-in): the only
  // thing that actually recomputes insights is visiting Profile
  // (InsightsSection's own rebuild-on-mount, unchanged by this phase),
  // so a fetch-once-at-login policy would leave Home showing a stale
  // (or null) insight until the next full reload even after the user
  // has since generated a new one. This is still a plain read
  // (insightsApi.getInsights(), no rebuild call) — Home never
  // rebuilds anything itself.
  useEffect(() => {
    if (!currentUser) {
      setAllInsights([]);
      return;
    }
    if (currentTab !== 'home' && currentTab !== 'explore') return;
    let cancelled = false;
    setIsInsightsLoading(true);
    insightsApi
      .getInsights()
      .then((result) => {
        if (!cancelled) setAllInsights(result.insights);
      })
      .catch((err) => {
        console.error('Failed to load insights:', err);
      })
      .finally(() => {
        if (!cancelled) setIsInsightsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, currentTab]);

  // Phase 21: the user's real entity list, loaded when Explore is first
  // visited (mirrors the insights-on-tab-visit pattern above rather
  // than fetching for every user regardless of whether they ever open
  // Explore). Cleared on sign-out/sign-in exactly like memories.
  useEffect(() => {
    if (!currentUser) {
      setEntities([]);
      setFocusEntityId(null);
      setIsEntitiesLoading(false);
      return;
    }
    if (currentTab !== 'explore') return;
    let cancelled = false;
    setIsEntitiesLoading(true);
    entityApi
      .list()
      .then((rows) => {
        if (cancelled) return;
        setEntities(rows);
      })
      .catch((err) => {
        console.error('Failed to load entities for Explore:', err);
      })
      .finally(() => {
        if (!cancelled) setIsEntitiesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, currentTab]);

  // Defaults (or re-anchors, if the previously focused entity vanished
  // — e.g. a different user signed in) the graph canvas to the first
  // loaded entity, so Explore never needs the user to make a first
  // pick just to see their own graph.
  useEffect(() => {
    if (entities.length === 0) {
      setFocusEntityId(null);
      return;
    }
    if (focusEntityId && entities.some((e) => e.id === focusEntityId)) return;
    setFocusEntityId(entities[0]!.id);
  }, [entities, focusEntityId]);

  // Phase 27: bumped whenever a relationship is created/removed from
  // EntityDetailModal or DecisionDetailModal (onGraphChanged), so the
  // traversal effect below re-runs even if the user never left Explore
  // — without this, the canvas would show stale edges until the next
  // tab switch (currentTab dependency alone doesn't catch an
  // in-Explore-already mutation).
  const [graphRefreshVersion, setGraphRefreshVersion] = useState(0);

  // Real bounded graph traversal for whichever entity is focused —
  // the same GET /entities/:id/related call EntityDetailModal already
  // makes, hops=2 to match that modal's default neighborhood size.
  useEffect(() => {
    if (!focusEntityId) {
      setRelatedResponse(null);
      return;
    }
    let cancelled = false;
    // Clear the PREVIOUS focus entity's neighbors immediately, not just
    // after the new fetch resolves — otherwise, for one render, the
    // canvas would combine the newly-focused entity (from `entities`,
    // updates synchronously) with the still-stale neighbor list from
    // whichever entity was focused before, which can legitimately
    // include the new focus entity itself as a neighbor and render it
    // twice (a real duplicate-key bug this fixes, not cosmetic).
    setRelatedResponse(null);
    setIsRelatedLoading(true);
    graphApi
      .getRelatedEntities(focusEntityId, 2)
      .then((result) => {
        if (!cancelled) setRelatedResponse(result);
      })
      .catch((err) => {
        console.error('Failed to load related entities:', err);
        if (!cancelled) setRelatedResponse(null);
      })
      .finally(() => {
        if (!cancelled) setIsRelatedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [focusEntityId, graphRefreshVersion]);

  // Phase 25/27: the user's real decisions (GET /decisions), loaded
  // when Profile is first visited — same lazy-on-tab-visit pattern as
  // entities/insights above. Lifted here (rather than fetched inside
  // DecisionsSection itself) specifically so DecisionDetailModal's
  // onDecisionChanged can patch this one shared array directly after a
  // mutation — the fix for the real bug Phase 26 found: a status/
  // outcome/evidence change made from the detail modal used to leave
  // the list showing stale data until the section remounted.
  const [decisions, setDecisions] = useState<DecisionDto[]>([]);
  const [isDecisionsLoading, setIsDecisionsLoading] = useState(true);
  const [decisionsError, setDecisionsError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) {
      setDecisions([]);
      setIsDecisionsLoading(false);
      setDecisionsError(null);
      return;
    }
    if (currentTab !== 'profile') return;
    let cancelled = false;
    setIsDecisionsLoading(true);
    setDecisionsError(null);
    decisionsApi
      .list()
      .then((rows) => {
        if (!cancelled) setDecisions(rows);
      })
      .catch(() => {
        if (!cancelled) setDecisionsError("Couldn't load your decisions right now.");
      })
      .finally(() => {
        if (!cancelled) setIsDecisionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, currentTab]);

  /** Patches one decision in place — the direct, targeted state update Phase 27 uses instead of a full list refetch or a remount. */
  function updateDecisionInList(updated: DecisionDto) {
    setDecisions((prev) => (prev.some((d) => d.id === updated.id) ? prev.map((d) => (d.id === updated.id ? updated : d)) : prev));
  }

  useEffect(() => {
    // Never persist a mid-flight placeholder — on reload it would just
    // look permanently stuck (its request no longer exists to resolve
    // it). Completed answers and failed (retryable) messages both
    // persist normally.
    const persistable = chatMessages.filter((m) => !m.pending);
    localStorage.setItem('twin_chat', JSON.stringify(persistable));
  }, [chatMessages]);

  // Modals & Panels
  const [isCaptureOpen, setIsCaptureOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isPrivacyOpen, setIsPrivacyOpen] = useState(false);
  const [isDeepExplorationOpen, setIsDeepExplorationOpen] = useState(false);
  const [isContextDrawerOpen, setIsContextDrawerOpen] = useState(false);
  const [selectedMemoryDetail, setSelectedMemoryDetail] = useState<MemoryItem | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedDecisionId, setSelectedDecisionId] = useState<string | null>(null);
  // Phase 29 Part 12: when a memory is opened from EntityDetailModal or
  // DecisionDetailModal, remember where it came from so closing
  // MemoryDetailModal returns there instead of just closing. Left unset
  // (and untouched) by every other onSelectMemory call site, so opening a
  // memory from Home, the Memory screen, etc. keeps closing normally. A
  // ref (not state) because it's only ever read inside the same
  // synchronous click handler that sets it (e.g. "Discuss with Twin"
  // clearing it right before onClose reads it) — state's async update
  // would leave onClose reading the pre-update value in that handler.
  const memoryOriginRef = useRef<{ type: 'entity' | 'decision'; id: string } | null>(null);
  const [selectedFactId, setSelectedFactId] = useState<string | null>(null);
  const [selectedInsightId, setSelectedInsightId] = useState<string | null>(null);
  const [contextInsightId, setContextInsightId] = useState<string | null>(null);
  const [contextPreviewQuery, setContextPreviewQuery] = useState<string | null>(null);
  const [activeAccountSection, setActiveAccountSection] = useState<AccountSection | null>(null);

  // Handlers — all backed by the real API now. Capture (the raw-input
  // flow: Note/Voice Memo) goes through the ingestion pipeline, which
  // adds duplicate detection and (non-AI) entity-mention linking on
  // top of the same memory-creation path everything else uses.
  const handleSaveMemory = async (newMem: Omit<MemoryItem, 'id'>) => {
    try {
      const result = await ingestionApi.ingest(
        toCreateIngestionRequest({
          title: newMem.title,
          description: newMem.description,
          category: newMem.category,
          sourceType: newMem.sourceType ?? 'manual',
          tags: newMem.tags,
        }),
      );
      if (result.memory && !result.job.isDuplicate) {
        setMemories((prev) => [toMemoryItem(result.memory!), ...prev]);
      } else if (!result.memory) {
        console.error('Ingestion failed:', result.job.errorMessage);
      }
      // A duplicate capture's `memory` is the pre-existing row already
      // in `memories` state (see ingestion.service.ts's dedup path) —
      // prepending it again would insert a second entry with the same
      // id, breaking every list keyed by memory id (a real bug Phase 22
      // browser verification surfaced). Nothing needs to change in
      // local state; the memory already exists exactly as it did.
    } catch (err) {
      console.error('Failed to save memory:', err);
    }
  };

  const handleDeleteMemory = async (id: string) => {
    try {
      await memoryApi.archive(id);
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      console.error('Failed to archive memory:', err);
    }
  };

  // Phase 15: dismisses Home's real highlighted insight — the exact
  // same soft-dismiss insightsApi.dismissInsight() Profile's
  // InsightsSection already uses, not a second dismissal mechanism.
  // Clears it locally right away rather than waiting on a refetch, so
  // Home doesn't flash the same (now-dismissed) card before it
  // disappears — Profile's own list independently re-excludes it via
  // the server-side dismissedAt filter next time it loads.
  const handleDismissTopInsight = async (insightId: string) => {
    try {
      await insightsApi.dismissInsight(insightId);
      setAllInsights((prev) => prev.filter((i) => i.id !== insightId));
    } catch (err) {
      console.error('Failed to dismiss insight from Home:', err);
    }
  };

  // Phase 20 — Twin Chat's real request lifecycle. Runs (or re-runs, for
  // retry) POST /chat for one assistant message id and writes the
  // result — or an honest error — back into that same message. The
  // frontend never invents `content` here; it only reflects what
  // chatApi.send() returned. `historyMessages` is the transcript AS OF
  // just before this call (including the user's new message, excluding
  // the assistant placeholder itself) — sliced and mapped down to the
  // bounded {role, content} shape the backend accepts.
  const runTwinReasoning = async (assistantId: string, userContent: string, historyMessages: ChatMessage[], targetEntityId?: string) => {
    const conversationHistory = historyMessages
      .filter((m) => !m.pending && !m.error)
      .slice(-CHAT_HISTORY_TURNS)
      .map((m) => ({ role: m.role, content: m.content }));

    setChatMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, pending: true, error: undefined } : m)));

    try {
      const result = await chatApi.send({ message: userContent, conversationHistory, targetEntityId });
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? result.reasoningFailure
              ? // Phase 29: a provider failure was safely handled server-side (never
                // fabricated) — surface it as a recoverable error, not a real answer.
                { ...m, pending: false, error: result.answer, retryable: result.retryable ?? true }
              : {
                  id: assistantId,
                  role: 'assistant',
                  content: result.answer,
                  timestamp: formatChatTimestamp(),
                  supportLevel: result.supportLevel,
                  confidence: result.confidence,
                  caveats: result.caveats,
                  uncertaintyNote: result.uncertaintyNote,
                  intent: result.intent,
                  evidence: result.evidence,
                }
            : m,
        ),
      );
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Twin could not respond right now. Please try again.';
      setChatMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, pending: false, error: message, retryable: true } : m)));
    }
  };

  const handleSendMessage = (content: string, targetEntityId?: string) => {
    const trimmed = content.trim();
    // Phase 29: block duplicate sends (double-click, repeated Enter, retry-spam)
    // while a request is already in flight — mirrors the disabled-send-button
    // UI guard in TwinChatView, but also covers programmatic callers like
    // handleAskTwin/quick-prompts that don't go through that button.
    if (!trimmed || chatMessages.some((m) => m.pending)) return;
    const historySnapshot = chatMessages;
    const userMsg: ChatMessage = { id: `msg-${Date.now()}`, role: 'user', content: trimmed, timestamp: formatChatTimestamp(), targetEntityId };
    const assistantId = `msg-${Date.now() + 1}`;
    const pendingMsg: ChatMessage = { id: assistantId, role: 'assistant', content: '', timestamp: formatChatTimestamp(), pending: true };
    setChatMessages((prev) => [...prev, userMsg, pendingMsg]);
    void runTwinReasoning(assistantId, trimmed, [...historySnapshot, userMsg], targetEntityId);
  };

  const handleRetryMessage = (assistantId: string) => {
    if (chatMessages.some((m) => m.pending)) return;
    const idx = chatMessages.findIndex((m) => m.id === assistantId);
    if (idx <= 0) return;
    const userMsg = chatMessages[idx - 1];
    if (!userMsg || userMsg.role !== 'user') return;
    const historyBefore = chatMessages.slice(0, idx - 1);
    void runTwinReasoning(assistantId, userMsg.content, [...historyBefore, userMsg], userMsg.targetEntityId);
  };

  const handleAskTwin = (query: string, targetEntityId?: string) => {
    setCurrentTab('twin');
    handleSendMessage(query, targetEntityId);
  };

  // Resets the still-mocked chat demo feature back to its seed state.
  // Deliberately does NOT touch memories any more — those are real,
  // persisted data now, not something to silently replace with mock
  // seeds.
  const handleResetVault = () => {
    localStorage.removeItem('twin_chat');
    setChatMessages([]);
  };

  const toggleMemoryActive = (id: string) => {
    setActiveMemoryIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  // 1. Startup Splash Screen
  if (!hasFinishedSplash) {
    return <SplashScreen onComplete={() => setHasFinishedSplash(true)} />;
  }

  // 1b. Restoring session (checking the httpOnly refresh cookie against
  // the API). In practice this resolves well within the splash screen's
  // own duration on a local API — this only ever renders on a slow
  // connection, so a returning user never flashes the sign-in screen.
  if (isAuthChecking) {
    return (
      <div
        className="min-h-screen w-full flex items-center justify-center bg-[#050505] text-white light:bg-[#f8fafc] light:text-slate-900 transition-colors duration-300 font-sans"
        role="status"
        aria-live="polite"
      >
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-indigo-400/30 border-t-indigo-400 animate-spin" />
          <span className="text-xs font-mono uppercase tracking-wider text-white/40 light:text-slate-400">
            Restoring session…
          </span>
        </div>
      </div>
    );
  }

  // 2. Unauthenticated Sign-In & Sign-Up Flow
  if (!isAuthenticated) {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="twin-auth"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.02 }}
          transition={{ duration: 0.35 }}
          className="min-h-screen bg-[#050505] text-white light:bg-[#f8fafc] light:text-slate-900 transition-colors duration-300 font-sans"
        >
          <AuthView />
        </motion.div>
      </AnimatePresence>
    );
  }

  // 3. Authenticated Main Application
  return (
    <div
      className="min-h-screen bg-[#050505] text-white light:bg-[#f8fafc] light:text-slate-900 transition-colors duration-300 font-sans selection:bg-indigo-500/30 selection:text-indigo-200 flex flex-col justify-between overflow-x-hidden relative"
      style={{
        backgroundImage:
          resolvedTheme === 'dark'
            ? 'radial-gradient(circle at 0% 0%, #1a1a2e 0%, #050505 50%), radial-gradient(circle at 100% 100%, #2a1b3d 0%, #050505 50%)'
            : 'radial-gradient(circle at 0% 0%, #e2e8f0 0%, #f8fafc 50%), radial-gradient(circle at 100% 100%, #ede9fe 0%, #f8fafc 50%)',
        backgroundAttachment: 'fixed',
      }}
    >
      {/* Top Application Bar */}
      <TopAppBar
        currentTab={currentTab}
        theme={resolvedTheme}
        themePreference={themePreference}
        onSelectTheme={setThemePreference}
        onToggleTheme={() =>
          setThemePreference(themePreference === 'dark' ? 'light' : 'dark')
        }
        onOpenSearch={() => setIsSearchOpen(true)}
        onOpenCapture={() => setIsCaptureOpen(true)}
        onSelectTab={setCurrentTab}
        onOpenAccountSection={(sec) => setActiveAccountSection(sec)}
      />

      {/* Main View Area with fluid Page Transition Animations */}
      <main className="pt-20 sm:pt-24 px-4 sm:px-6 w-full max-w-5xl mx-auto flex-1 pb-24 sm:pb-28">
        <>
          {currentTab === 'home' && (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <HomeView
                onSelectTab={setCurrentTab}
                onAskTwin={handleAskTwin}
                memories={memories}
                onSelectMemory={(mem) => setSelectedMemoryDetail(mem)}
                onOpenCapture={() => setIsCaptureOpen(true)}
                onInspectFact={(factId) => setSelectedFactId(factId)}
                topInsight={topInsight}
                onInspectTopInsight={() => topInsight && setSelectedInsightId(topInsight.id)}
                onDismissTopInsight={() => topInsight && handleDismissTopInsight(topInsight.id)}
                onOpenTopInsightContext={() => topInsight && setContextInsightId(topInsight.id)}
              />
            </motion.div>
          )}

          {currentTab === 'twin' && (
            <motion.div
              key="twin"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <TwinChatView
                messages={chatMessages}
                onSendMessage={handleSendMessage}
                onRetryMessage={handleRetryMessage}
                onOpenContextDrawer={() => setIsContextDrawerOpen(true)}
                onInspectEvidence={(msg) => setInspectingChatMessage(msg)}
              />
            </motion.div>
          )}

          {currentTab === 'memory' && (
            <motion.div
              key="memory"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              {isMemoriesLoading ? (
                <div className="flex flex-col items-center justify-center gap-3 py-24">
                  <div className="w-8 h-8 rounded-full border-2 border-indigo-400/30 border-t-indigo-400 animate-spin" />
                  <span className="text-xs font-mono uppercase tracking-wider text-slate-400 dark:text-white/40">
                    Loading memories…
                  </span>
                </div>
              ) : (
                <MemoryView
                  memories={memories}
                  onOpenCapture={() => setIsCaptureOpen(true)}
                  onSelectMemory={(mem) => setSelectedMemoryDetail(mem)}
                />
              )}
            </motion.div>
          )}

          {currentTab === 'explore' && (
            <motion.div
              key="explore"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <ExploreView
                entities={entities}
                isEntitiesLoading={isEntitiesLoading}
                focusEntityId={focusEntityId}
                onSelectFocusEntity={setFocusEntityId}
                relatedNodes={relatedResponse?.nodes ?? null}
                isRelatedLoading={isRelatedLoading}
                onDeepExploration={() => setIsDeepExplorationOpen(true)}
                onAskAboutNode={(node) => {
                  handleAskTwin(`Tell me about ${node.name} and how it relates to my current priorities.`, node.id);
                }}
                onInspectNode={(node) => setSelectedEntityId(node.id)}
              />
            </motion.div>
          )}

          {currentTab === 'profile' && (
            <motion.div
              key="profile"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <ProfileView
                onOpenPrivacy={() => setIsPrivacyOpen(true)}
                onSelectTab={setCurrentTab}
                onInspectFact={(factId) => setSelectedFactId(factId)}
                onInspectInsight={(insightId) => setSelectedInsightId(insightId)}
                onSelectMemory={(mem) => setSelectedMemoryDetail(mem)}
                onOpenDecision={(id) => setSelectedDecisionId(id)}
                decisions={decisions}
                isDecisionsLoading={isDecisionsLoading}
                decisionsError={decisionsError}
                onDecisionCreated={(decision) => setDecisions((prev) => [decision, ...prev])}
              />
            </motion.div>
          )}
        </>
      </main>

      {/* Persistent Frosted Glass Bottom Nav Dock */}
      <BottomNavBar currentTab={currentTab} onSelectTab={setCurrentTab} />

      {/* Frosted Intelligence Status Footer */}
      <footer className="h-11 sm:h-12 border-t border-slate-200/80 dark:border-white/10 bg-white/60 dark:bg-black/40 backdrop-blur-xl flex items-center justify-between px-4 sm:px-8 text-[10px] sm:text-[11px] text-slate-500 dark:text-white/40 font-medium uppercase tracking-[0.2em] relative z-20">
        <div className="flex items-center gap-4 sm:gap-8">
          <span className="flex items-center gap-1.5 text-slate-700 dark:text-white/70">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#4ade80]" />
            Secure Node: NY-042
          </span>
          <span className="hidden sm:inline text-slate-400 dark:text-white/30">
            AES-256 GCM
          </span>
        </div>
        <div className="flex items-center gap-4 sm:gap-8">
          <span className="text-indigo-600 dark:text-indigo-400 font-semibold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
            Identity Verified
          </span>
          <span className="hidden md:inline text-slate-400 dark:text-white/30">
            © 2026 Twin Systems
          </span>
        </div>
      </footer>

      {/* Modals & Drawers */}
      <CaptureModal
        isOpen={isCaptureOpen}
        onClose={() => setIsCaptureOpen(false)}
        onSaveMemory={handleSaveMemory}
      />

      <PrivacyModal
        isOpen={isPrivacyOpen}
        onClose={() => setIsPrivacyOpen(false)}
        onResetVault={handleResetVault}
      />

      <DeepExplorationModal
        isOpen={isDeepExplorationOpen}
        onClose={() => setIsDeepExplorationOpen(false)}
        onNavigateToTwin={handleAskTwin}
        insights={explorationInsights}
        isLoading={isInsightsLoading}
      />

      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectMemory={(mem) => setSelectedMemoryDetail(mem)}
        onSelectTab={setCurrentTab}
        onAskTwin={handleAskTwin}
        onViewContext={(query) => setContextPreviewQuery(query)}
      />

      <ContextDrawer
        isOpen={isContextDrawerOpen}
        onClose={() => setIsContextDrawerOpen(false)}
        memories={memories}
        activeMemoryIds={activeMemoryIds}
        onToggleMemoryActive={toggleMemoryActive}
      />

      <MemoryDetailModal
        memory={selectedMemoryDetail}
        onClose={() => {
          setSelectedMemoryDetail(null);
          const origin = memoryOriginRef.current;
          if (origin) {
            if (origin.type === 'entity') setSelectedEntityId(origin.id);
            else setSelectedDecisionId(origin.id);
            memoryOriginRef.current = null;
          }
        }}
        onDiscussWithTwin={(mem) => {
          // Discussing with Twin deliberately navigates away — clear the
          // origin so onClose (called right after this, same click) doesn't
          // pop the origin entity back over chat.
          memoryOriginRef.current = null;
          handleAskTwin(`Let's discuss my note "${mem.title}": ${mem.description}`);
        }}
        onDeleteMemory={handleDeleteMemory}
        onOpenEntity={(entityId) => setSelectedEntityId(entityId)}
      />

      <EntityDetailModal
        entityId={selectedEntityId}
        onClose={() => setSelectedEntityId(null)}
        onSelectMemory={(mem) => {
          memoryOriginRef.current = selectedEntityId ? { type: 'entity', id: selectedEntityId } : null;
          setSelectedEntityId(null);
          setSelectedMemoryDetail(mem);
        }}
        onOpenDecision={(id) => setSelectedDecisionId(id)}
        onGraphChanged={() => setGraphRefreshVersion((v) => v + 1)}
      />

      <DecisionDetailModal
        decisionId={selectedDecisionId}
        onClose={() => setSelectedDecisionId(null)}
        onSelectMemory={(mem) => {
          memoryOriginRef.current = selectedDecisionId ? { type: 'decision', id: selectedDecisionId } : null;
          setSelectedDecisionId(null);
          setSelectedEntityId(null);
          setSelectedMemoryDetail(mem);
        }}
        onOpenEntity={(entityId) => {
          setSelectedDecisionId(null);
          setSelectedEntityId(entityId);
        }}
        onDecisionChanged={updateDecisionInList}
        onGraphChanged={() => setGraphRefreshVersion((v) => v + 1)}
      />

      <FactEvidenceModal
        factId={selectedFactId}
        onClose={() => setSelectedFactId(null)}
        onSelectMemory={(mem) => {
          setSelectedFactId(null);
          setSelectedMemoryDetail(mem);
        }}
      />

      <InsightEvidenceModal
        insightId={selectedInsightId}
        onClose={() => setSelectedInsightId(null)}
        onSelectMemory={(mem) => {
          setSelectedInsightId(null);
          setSelectedMemoryDetail(mem);
        }}
        onSelectPersonalModelFact={(factId) => {
          setSelectedInsightId(null);
          setSelectedFactId(factId);
        }}
        onSelectInsight={(insightId) => setSelectedInsightId(insightId)}
      />

      <InsightContextModal
        insightId={contextInsightId}
        onClose={() => setContextInsightId(null)}
        onSelectFact={(factId) => {
          setContextInsightId(null);
          setSelectedFactId(factId);
        }}
      />

      <ContextPreviewModal
        query={contextPreviewQuery}
        onClose={() => setContextPreviewQuery(null)}
        onSelectMemory={(mem) => {
          setContextPreviewQuery(null);
          setSelectedMemoryDetail(mem);
        }}
      />

      <ChatEvidenceModal
        message={inspectingChatMessage}
        onClose={() => setInspectingChatMessage(null)}
        onSelectMemory={(mem) => {
          setInspectingChatMessage(null);
          setSelectedMemoryDetail(mem);
        }}
        onSelectEntity={(entityId) => {
          setInspectingChatMessage(null);
          setSelectedEntityId(entityId);
        }}
        onSelectFact={(factId) => {
          setInspectingChatMessage(null);
          setSelectedFactId(factId);
        }}
        onSelectInsight={(insightId) => {
          setInspectingChatMessage(null);
          setSelectedInsightId(insightId);
        }}
      />

      {/* Account Control Center Modal */}
      {activeAccountSection && (
        <AccountModal
          isOpen={!!activeAccountSection}
          initialSection={activeAccountSection}
          onClose={() => setActiveAccountSection(null)}
          onResetVault={handleResetVault}
          onSignOut={signOut}
        />
      )}
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <AppProvider>
      <TwinAppInner />
    </AppProvider>
  );
};

export default App;
