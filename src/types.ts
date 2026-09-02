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
  source: string; // e.g. "Voice Note", "Manual Entry", "System Synthesis", "Screen Capture"
  sourceType?: 'voice' | 'manual' | 'synthesis' | 'screen';
  explicit: boolean;
  tags?: string[];
  linkedEntity?: string;
  imageUrl?: string;
  personRole?: string;
  statusBadge?: string;
}

export interface TwinSuggestion {
  id: string;
  tone: 'warm' | 'direct' | 'casual';
  label: string;
  text: string;
  whyThisFits: string;
  icon: string;
  accentColor: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  activeMemoriesCount?: number;
  contextPerson?: string;
  contextTag?: string;
  suggestions?: TwinSuggestion[];
}

export interface GraphNode {
  id: string;
  name: string;
  type: 'project' | 'person' | 'decision' | 'memory' | 'idea';
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

export interface DecisionItem {
  id: string;
  title: string;
  duration: string;
  proWeight: number; // e.g. 15
  description: string;
  pros: string[];
  cons: string[];
  status: 'unresolved' | 'finalized';
  category: string;
  dateCreated: string;
}

export interface ActiveThread {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  documentsCount?: number;
  status: 'active' | 'monitoring' | 'completed';
}

export interface TwinModelProfile {
  name: string;
  codename: string;
  status: 'Active & Syncing' | 'Calibrating' | 'Offline';
  entitiesCount: number;
  peopleCount: number;
  goalsCount: number;
  projectsCount: number;
  explicitRatio: number;
  inferredRatio: number;
  uncertainRatio: number;
  confirmedMemoriesStatus: string;
  growingInsightsStatus: string;
  needsClarificationStatus: string;
}
