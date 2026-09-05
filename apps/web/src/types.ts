import type { ChatEvidence, IntentType, SupportLevel } from '@twin/contracts';

export type TabType = 'home' | 'twin' | 'memory' | 'explore' | 'profile';

export type ThemeMode = 'dark' | 'light';
export type ThemePreference = 'dark' | 'light' | 'system';
export type AccentColor = 'indigo' | 'violet' | 'emerald' | 'amber';
export type FrostedIntensity = 'subtle' | 'balanced' | 'deep';

export type AccountSection =
  | 'profile'
  | 'settings'
  | 'notifications'
  | 'privacy'
  | 'data'
  | 'appearance'
  | 'about'
  | 'signout';

export interface UserPreferences {
  assistantTone: 'warm' | 'direct' | 'casual' | 'academic';
  proactivityLevel: 'subtle' | 'balanced' | 'expressive';
  autoSynthesis: boolean;
  soundEffects: boolean;
  // Notifications
  masterNotifications: boolean;
  morningBriefing: boolean;
  eveningRecap: boolean;
  patternAlerts: boolean;
  insightUpdates: boolean;
  memoryReminders: boolean;
  dailySummary: boolean;
  // Privacy & Security
  biometricLock: boolean;
  autoLockMinutes: 'immediate' | '5' | '15' | 'never';
  incognitoMode: boolean;
  micAccess: boolean;
  retentionPeriod: 'forever' | '1year' | '90days';
}

export type MemoryCategory = 'people' | 'projects' | 'ideas' | 'decisions';

export interface MemoryItem {
  id: string;
  category: MemoryCategory;
  title: string;
  description: string;
  date: string;
  /** Phase 24: the same instant `date` renders as a human string, kept as a real ISO timestamp so Home's intelligence layer can do actual date math (e.g. "captured today") without reparsing a locale-formatted string. */
  occurredAtIso: string;
  source: string; // e.g. "Voice Note", "Manual Entry", "System Synthesis", "Screen Capture"
  sourceType?: 'voice' | 'manual' | 'synthesis' | 'screen';
  explicit: boolean;
  tags?: string[];
  linkedEntity?: string;
  /** Phase 7: real entity id backing `linkedEntity`'s name, when the memory came from the real API — lets the UI open the entity's real graph detail instead of just displaying its name as text. */
  linkedEntityId?: string;
  imageUrl?: string;
  personRole?: string;
  statusBadge?: string;
}

/**
 * Phase 20: a chat turn. Everything below `timestamp` on an assistant
 * message is the real, backend-computed GroundedResponse (see
 * services/chatApi.ts / @twin/contracts ChatResponse) — never invented
 * client-side. `pending`/`error` track this specific message's request
 * lifecycle; a message is never both.
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  /** True while this assistant message is awaiting the backend's response. */
  pending?: boolean;
  /** Set when the request for this assistant message failed — the content to show instead of an answer, with a retry affordance. */
  error?: string;
  /** Phase 29: true when a failed request can be safely retried as-is (vs. a config problem retrying won't fix). */
  retryable?: boolean;
  supportLevel?: SupportLevel;
  confidence?: number;
  caveats?: string[];
  uncertaintyNote?: string | null;
  intent?: IntentType;
  evidence?: ChatEvidence;
  /**
   * Phase 28/29: the entity this turn was explicitly grounded to (e.g. Explore's
   * "Ask Twin about this"). Stored on the user message so a retry of the paired
   * assistant message can resend the same explicit-target grounding instead of
   * silently falling back to fuzzy entity matching.
   */
  targetEntityId?: string;
}

/**
 * Phase 21: a node in Explore's knowledge graph view — one real entity
 * (see @twin/contracts EntityType) plus UI-only layout/display fields
 * computed by services/graphMapper.ts. `type` matches EntityType
 * exactly (no 'memory' — a graph node is always an entity, never a
 * memory) so a real EntityDto maps onto this without a lossy cast.
 */
export interface GraphNode {
  id: string;
  name: string;
  type: 'project' | 'person' | 'goal' | 'decision' | 'idea' | 'event';
  cluster: string;
  description: string;
  x?: number;
  y?: number;
  icon: string;
  avatarUrl?: string;
  color?: string;
  connectedTo: string[];
  lastActive?: string;
}

