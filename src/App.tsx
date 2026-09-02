import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  TabType,
  ThemeMode,
  ThemePreference,
  AccountSection,
  MemoryItem,
  ChatMessage,
  DecisionItem,
  GraphNode,
  ActiveThread,
  TwinModelProfile,
  TwinSuggestion,
} from './types';
import {
  INITIAL_MEMORIES,
  INITIAL_CHAT_MESSAGES,
  INITIAL_DECISION,
  KNOWLEDGE_GRAPH_NODES,
  ACTIVE_THREADS,
  INITIAL_MODEL_PROFILE,
} from './data/mockData';
import { AppProvider, useApp } from './context/AppContext';
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
import { DecisionLogicModal } from './components/DecisionLogicModal';
import { PrivacyModal } from './components/PrivacyModal';
import { DeepExplorationModal } from './components/DeepExplorationModal';
import { SearchModal } from './components/SearchModal';
import { ContextDrawer } from './components/ContextDrawer';
import { MemoryDetailModal } from './components/MemoryDetailModal';
import { AccountModal } from './components/AccountModal';

const TwinAppInner: React.FC = () => {
  const {
    isAuthenticated,
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

  // Core Data States
  const [memories, setMemories] = useState<MemoryItem[]>(() => {
    const saved = localStorage.getItem('twin_memories');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
    return INITIAL_MEMORIES;
  });

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem('twin_chat');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
    return INITIAL_CHAT_MESSAGES;
  });

  const [decision, setDecision] = useState<DecisionItem>(() => {
    const saved = localStorage.getItem('twin_decision');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
    return INITIAL_DECISION;
  });

  const [nodes, setNodes] = useState<GraphNode[]>(KNOWLEDGE_GRAPH_NODES);
  const [threads, setThreads] = useState<ActiveThread[]>(ACTIVE_THREADS);
  const [modelProfile, setModelProfile] = useState<TwinModelProfile>(INITIAL_MODEL_PROFILE);
  const [activeMemoryIds, setActiveMemoryIds] = useState<string[]>([
    'mem-1',
    'mem-2',
    'mem-3',
    'mem-4',
  ]);

  // Sync to local storage
  useEffect(() => {
    localStorage.setItem('twin_memories', JSON.stringify(memories));
    setModelProfile((prev) => ({
      ...prev,
      entitiesCount: 124 + memories.length,
    }));
  }, [memories]);

  useEffect(() => {
    localStorage.setItem('twin_chat', JSON.stringify(chatMessages));
  }, [chatMessages]);

  useEffect(() => {
    localStorage.setItem('twin_decision', JSON.stringify(decision));
  }, [decision]);

  // Modals & Panels
  const [isCaptureOpen, setIsCaptureOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isDecisionOpen, setIsDecisionOpen] = useState(false);
  const [isPrivacyOpen, setIsPrivacyOpen] = useState(false);
  const [isDeepExplorationOpen, setIsDeepExplorationOpen] = useState(false);
  const [isContextDrawerOpen, setIsContextDrawerOpen] = useState(false);
  const [selectedMemoryDetail, setSelectedMemoryDetail] = useState<MemoryItem | null>(null);
  const [activeAccountSection, setActiveAccountSection] = useState<AccountSection | null>(null);

  // Handlers
  const handleSaveMemory = (newMem: Omit<MemoryItem, 'id'>) => {
    const created: MemoryItem = {
      ...newMem,
      id: `mem-${Date.now()}`,
    };
    setMemories((prev) => [created, ...prev]);
  };

  const handleDeleteMemory = (id: string) => {
    setMemories((prev) => prev.filter((m) => m.id !== id));
  };

  const handleFinalizeDecision = () => {
    setDecision((prev) => ({ ...prev, status: 'finalized' }));
    handleSaveMemory({
      title: 'Finalized: Move to London Decision',
      description:
        'Officially approved career move to London hub based on 15% net algorithmic advantage and senior research access.',
      category: 'decisions',
      date: 'Just now',
      source: 'System Synthesis',
      sourceType: 'synthesis',
      explicit: true,
      tags: ['#decision', '#london', '#finalized'],
      linkedEntity: 'Project Helios',
    });
  };

  const handleAddPro = (pro: string) => {
    setDecision((prev) => ({
      ...prev,
      pros: [...prev.pros, pro],
      proWeight: Math.min(prev.proWeight + 4, 35),
    }));
  };

  const handleAddCon = (con: string) => {
    setDecision((prev) => ({
      ...prev,
      cons: [...prev.cons, con],
      proWeight: Math.max(prev.proWeight - 4, -10),
    }));
  };

  const handleSynthesizeInsight = (topic: string) => {
    handleSaveMemory({
      title: `Synthesis: ${topic} Framework`,
      description: `Consolidated 4 scattered thought records regarding ${topic} into a unified architectural spec with dynamic specular edge lighting and liquid glass tokens.`,
      category: 'ideas',
      date: 'Just now',
      source: 'System Synthesis',
      sourceType: 'synthesis',
      explicit: true,
      tags: ['#synthesis', '#liquid-interfaces', '#design-system'],
      linkedEntity: 'Liquid Glass System',
    });
    setCurrentTab('memory');
  };

  const handleSendMessage = (content: string) => {
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content,
      timestamp: 'Just now',
    };

    setChatMessages((prev) => [...prev, userMsg]);

    // Context-aware Twin reasoning response
    setTimeout(() => {
      let assistantReply: ChatMessage;
      const lower = content.toLowerCase();

      if (
        lower.includes('sarah') ||
        lower.includes('trip') ||
        lower.includes('house') ||
        lower.includes('save')
      ) {
        const suggestions: TwinSuggestion[] = [
          {
            id: `sug-${Date.now()}-1`,
            tone: 'warm',
            label: 'Warm Reassurance',
            icon: 'favorite',
            accentColor: '#c2c1ff',
            text: '"Sarah, I love brainstorming adventures with you, but I need to stick strictly to my $500 monthly house fund right now. Could we explore a scenic local weekend trip instead?"',
            whyThisFits:
              'Directly bridges your priority of home ownership while protecting emotional warmth with Sarah before her Patagonia sabbatical.',
          },
          {
            id: `sug-${Date.now()}-2`,
            tone: 'direct',
            label: 'Direct Constraint',
            icon: 'straight',
            accentColor: '#ffb785',
            text: '"I checked my financial allocations for Q3. I won\'t be joining the trip so I can meet my house milestone. Let\'s catch up when you\'re back!"',
            whyThisFits:
              'Firm boundary, avoids negotiation overhead, leaves zero ambiguity regarding financial constraints.',
          },
          {
            id: `sug-${Date.now()}-3`,
            tone: 'casual',
            label: 'Lighthearted',
            icon: 'coffee',
            accentColor: '#34c759',
            text: '"My wallet looked at the flight prices and fainted 😂 Gotta protect the house deposit fund! How about dinner on me next week instead?"',
            whyThisFits:
              'Lightens the mood with gentle self-deprecating humor while honoring the $500/mo deposit commitment.',
          },
        ];

        assistantReply = {
          id: `msg-${Date.now() + 1}`,
          role: 'assistant',
          content:
            "I cross-referenced your House Savings Goal ($500/mo) and Sarah's recent conversation. Here are 3 tailored responses balancing financial discipline with your relationship:",
          timestamp: 'Just now',
          activeMemoriesCount: 4,
          contextPerson: 'Sarah Jenkins',
          contextTag: 'House Savings Target',
          suggestions,
        };
      } else if (
        lower.includes('london') ||
        lower.includes('decision') ||
        lower.includes('relocate')
      ) {
        assistantReply = {
          id: `msg-${Date.now() + 1}`,
          role: 'assistant',
          content: `Your decision regarding "${decision.title}" currently stands at +${decision.proWeight}% in favor based on 3 weeks of logged considerations. Key driver: access to top-tier European AI labs outweighs the estimated 28% increase in living expenses. Would you like me to finalize this in your permanent graph?`,
          timestamp: 'Just now',
          activeMemoriesCount: 3,
        };
      } else if (
        lower.includes('helios') ||
        lower.includes('architecture') ||
        lower.includes('api')
      ) {
        assistantReply = {
          id: `msg-${Date.now() + 1}`,
          role: 'assistant',
          content:
            'In Project Helios, your latest whiteboard review agreed on migrating toward a streamlined API gateway while adopting Tailwind v4 tokens. Sarah Jenkins left 3 questions regarding rate-limiting boundaries. I can draft your response or schedule a 15-minute sync.',
          timestamp: 'Just now',
          activeMemoriesCount: 5,
        };
      } else {
        assistantReply = {
          id: `msg-${Date.now() + 1}`,
          role: 'assistant',
          content: `I've synthesized your thought against your 128 active knowledge nodes. Everything aligns with your ongoing focus on high-fidelity spatial design and on-device privacy. What would you like to explore or log next?`,
          timestamp: 'Just now',
          activeMemoriesCount: 4,
        };
      }

      setChatMessages((prev) => [...prev, assistantReply]);
    }, 750);
  };

  const handleAskTwin = (query: string) => {
    setCurrentTab('twin');
    handleSendMessage(query);
  };

  const handleResetVault = () => {
    localStorage.removeItem('twin_memories');
    localStorage.removeItem('twin_chat');
    localStorage.removeItem('twin_decision');
    setMemories(INITIAL_MEMORIES);
    setChatMessages(INITIAL_CHAT_MESSAGES);
    setDecision(INITIAL_DECISION);
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
        <AnimatePresence mode="wait">
          {currentTab === 'home' && (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <HomeView
                onSelectTab={setCurrentTab}
                onAskTwin={handleAskTwin}
                memories={memories}
                decision={decision}
                onOpenDecisionLogic={() => setIsDecisionOpen(true)}
                onFinalizeDecision={handleFinalizeDecision}
                onSynthesizeInsight={handleSynthesizeInsight}
                onSelectMemory={(mem) => setSelectedMemoryDetail(mem)}
              />
            </motion.div>
          )}

          {currentTab === 'twin' && (
            <motion.div
              key="twin"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <TwinChatView
                messages={chatMessages}
                onSendMessage={handleSendMessage}
                onOpenContextDrawer={() => setIsContextDrawerOpen(true)}
              />
            </motion.div>
          )}

          {currentTab === 'memory' && (
            <motion.div
              key="memory"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <MemoryView
                memories={memories}
                onOpenCapture={() => setIsCaptureOpen(true)}
                onSelectMemory={(mem) => setSelectedMemoryDetail(mem)}
              />
            </motion.div>
          )}

          {currentTab === 'explore' && (
            <motion.div
              key="explore"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <ExploreView
                nodes={nodes}
                onDeepExploration={() => setIsDeepExplorationOpen(true)}
                onAskAboutNode={(node) => {
                  handleAskTwin(
                    `Tell me about ${node.name} and how it relates to my current priorities.`
                  );
                }}
              />
            </motion.div>
          )}

          {currentTab === 'profile' && (
            <motion.div
              key="profile"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <ProfileView
                profile={modelProfile}
                threads={threads}
                onOpenPrivacy={() => setIsPrivacyOpen(true)}
                onSelectTab={setCurrentTab}
              />
            </motion.div>
          )}
        </AnimatePresence>
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

      <DecisionLogicModal
        isOpen={isDecisionOpen}
        onClose={() => setIsDecisionOpen(false)}
        decision={decision}
        onFinalize={handleFinalizeDecision}
        onAddPro={handleAddPro}
        onAddCon={handleAddCon}
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
      />

      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        memories={memories}
        onSelectMemory={(mem) => setSelectedMemoryDetail(mem)}
        onSelectTab={setCurrentTab}
        onAskTwin={handleAskTwin}
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
        onClose={() => setSelectedMemoryDetail(null)}
        onDiscussWithTwin={(mem) => {
          handleAskTwin(`Let's discuss my note "${mem.title}": ${mem.description}`);
        }}
        onDeleteMemory={handleDeleteMemory}
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
