import React, { useState, useEffect } from 'react';
import { AccountSection, ThemePreference, ThemeMode, AccentColor, FrostedIntensity } from '../types';
import { INITIAL_USER } from '../data/mockData';
import { useApp } from '../context/AppContext';
import { ToggleSwitch } from './ToggleSwitch';

interface AccountModalProps {
  isOpen: boolean;
  initialSection: AccountSection;
  onClose: () => void;
  themePreference?: ThemePreference;
  onSelectTheme?: (pref: ThemePreference) => void;
  resolvedTheme?: ThemeMode;
  onResetVault: () => void;
  onSignOut?: () => void;
}

export const AccountModal: React.FC<AccountModalProps> = ({
  isOpen,
  initialSection,
  onClose,
  onResetVault,
  onSignOut,
}) => {
  const {
    themePreference,
    setThemePreference,
    resolvedTheme,
    accentColor,
    setAccentColor,
    frostedIntensity,
    setFrostedIntensity,
    preferences,
    updatePreferences,
    userProfile,
    updateUserProfile,
    signOut,
  } = useApp();

  const [activeTab, setActiveTab] = useState<AccountSection>(initialSection || 'profile');

  // Keep activeTab in sync with initialSection when modal opens or initialSection changes
  useEffect(() => {
    if (isOpen && initialSection) {
      setActiveTab(initialSection);
    }
  }, [isOpen, initialSection]);

  // Profile Form States
  const [profileName, setProfileName] = useState(userProfile.name);
  const [profileEmail, setProfileEmail] = useState(userProfile.email);
  const [profileRole, setProfileRole] = useState(userProfile.role);
  const [profileBio, setProfileBio] = useState(userProfile.bio);
  const [profileSaved, setProfileSaved] = useState(false);

  // Sync profile fields if context updates
  useEffect(() => {
    setProfileName(userProfile.name);
    setProfileEmail(userProfile.email);
    setProfileRole(userProfile.role);
    setProfileBio(userProfile.bio);
  }, [userProfile]);

  // Data Export Status
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  if (!isOpen) return null;

  const isDark = resolvedTheme === 'dark';

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    updateUserProfile({
      name: profileName,
      displayName: profileName.split(' ')[0],
      email: profileEmail,
      role: profileRole,
      bio: profileBio,
    });
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 2500);
  };

  const handleExportData = (format: 'json' | 'markdown') => {
    setExportStatus(`Preparing encrypted ${format.toUpperCase()} archive...`);
    setTimeout(() => {
      const content =
        format === 'json'
          ? JSON.stringify(
              {
                user: { ...INITIAL_USER, ...userProfile },
                preferences,
                exportedAt: new Date().toISOString(),
                vaultVersion: '4.2.1',
              },
              null,
              2
            )
          : `# Twin Intelligence Vault Export\n\nUser: ${profileName} (${profileEmail})\nRole: ${profileRole}\nDate: ${new Date().toLocaleDateString()}\n\n## Bio\n${profileBio}\n\n## System Diagnostics\n- Encryption: AES-256 GCM\n- Zero Telemetry: Verified\n- Private Key ID: ${INITIAL_USER.encryptionKeyId}\n`;

      const blob = new Blob([content], {
        type: format === 'json' ? 'application/json' : 'text/markdown',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `twin-vault-backup-${new Date().toISOString().slice(0, 10)}.${
        format === 'json' ? 'json' : 'md'
      }`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportStatus(`✓ ${format.toUpperCase()} archive exported successfully!`);
      setTimeout(() => setExportStatus(null), 3000);
    }, 600);
  };

  const handleExecuteSignOut = () => {
    onClose();
    if (onSignOut) {
      onSignOut();
    } else {
      signOut();
    }
  };

  const tabs: { id: AccountSection; label: string; icon: string; badge?: string }[] = [
    { id: 'profile', label: 'Profile', icon: 'person' },
    { id: 'settings', label: 'Settings', icon: 'tune' },
    { id: 'notifications', label: 'Notifications', icon: 'notifications' },
    { id: 'privacy', label: 'Privacy & Security', icon: 'shield_lock' },
    { id: 'data', label: 'Memory & Data', icon: 'database' },
    { id: 'appearance', label: 'Appearance', icon: 'palette' },
    { id: 'about', label: 'Help & About', icon: 'info' },
    { id: 'signout', label: 'Sign Out / Lock', icon: 'lock' },
  ];

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-2.5 sm:p-4 md:p-6 bg-black/60 dark:bg-black/70 backdrop-blur-md animate-fadeIn overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-modal-title"
    >
      {/* Container with constrained height and fluid width */}
      <div className="w-full max-w-4xl h-[92vh] sm:h-[84vh] max-h-[760px] rounded-3xl bg-white/95 dark:bg-[#0c0d14]/95 border border-slate-200/90 dark:border-white/15 backdrop-blur-2xl shadow-2xl flex flex-col md:flex-row overflow-hidden relative text-slate-900 dark:text-white">
        {/* Left Sidebar (Desktop) / Top Horizontal Tab Bar (Mobile) */}
        <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-slate-200 dark:border-white/10 bg-slate-50/80 dark:bg-white/[0.02] flex flex-col shrink-0">
          {/* User mini badge at top of sidebar */}
          <div className="p-3.5 sm:p-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-full overflow-hidden border border-indigo-500/40 shrink-0">
                <img
                  src={
                    isDark
                      ? userProfile?.avatarUrl || INITIAL_USER.avatarUrl
                      : userProfile?.lightAvatarUrl || userProfile?.avatarUrl || INITIAL_USER.lightAvatarUrl
                  }
                  alt={profileName}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                  {profileName}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-white/50 truncate font-mono">
                  {profileEmail}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="md:hidden w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-white/60 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10"
              title="Close modal"
              aria-label="Close modal"
            >
              <span className="material-symbols-outlined text-[19px]">close</span>
            </button>
          </div>

          {/* Navigation Items (Scrollable tabs) */}
          <div className="flex md:flex-col overflow-x-auto md:overflow-y-auto p-2 sm:p-3 gap-1 scrollbar-none flex-1 min-h-0">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              const isSignOut = tab.id === 'signout';
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2.5 px-3 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all shrink-0 md:shrink select-none text-left cursor-pointer ${
                    isSignOut
                      ? isActive
                        ? 'bg-rose-500/20 text-rose-600 dark:text-rose-300 border border-rose-500/30'
                        : 'text-rose-500 hover:bg-rose-500/10'
                      : isActive
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 font-semibold'
                      : 'text-slate-600 dark:text-white/60 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/5'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px] shrink-0">
                    {tab.icon}
                  </span>
                  <span className="truncate flex-1">{tab.label}</span>
                  {tab.badge && (
                    <span className="hidden md:inline-block text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/70">
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Account Status Footer on Sidebar (Desktop) */}
          <div className="hidden md:flex p-3.5 border-t border-slate-200 dark:border-white/10 items-center justify-between text-[11px] font-mono text-slate-500 dark:text-white/40">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Vault Active (AES-256)
            </span>
            <span className="px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 font-bold border border-indigo-200 dark:border-indigo-500/30">
              PRO
            </span>
          </div>
        </div>

        {/* Right Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Top Header Bar */}
          <div className="h-14 px-5 sm:px-7 border-b border-slate-200 dark:border-white/10 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <span
                id="account-modal-title"
                className="text-xs font-mono uppercase tracking-widest text-indigo-600 dark:text-indigo-400 font-bold"
              >
                {tabs.find((t) => t.id === activeTab)?.label}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-white/50 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10 transition-colors cursor-pointer"
              title="Close modal"
              aria-label="Close modal"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          {/* Content Pane (Scrolls naturally) */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-7 space-y-6">
            {/* 1. Profile Section */}
            {activeTab === 'profile' && (
              <div className="space-y-6 max-w-xl">
                <div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                    Personal Identity &amp; Account
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-white/60 mt-1">
                    Manage your personal account credentials, biographical context, and device authorizations.
                  </p>
                </div>

                {/* Avatar Banner */}
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center gap-4">
                  <div className="relative shrink-0">
                    <img
                      src={isDark ? INITIAL_USER.avatarUrl : INITIAL_USER.lightAvatarUrl}
                      alt={profileName}
                      className="w-16 h-16 rounded-full object-cover border-2 border-indigo-500/50 shadow-md"
                    />
                    <span className="absolute bottom-0 right-0 w-4 h-4 rounded-full bg-emerald-400 border-2 border-white dark:border-[#0c0d14]" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-base text-slate-900 dark:text-white truncate">
                        {profileName}
                      </h4>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 font-bold border border-indigo-200 dark:border-indigo-500/30 shrink-0">
                        PRO NEURAL
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-white/50 font-mono mt-0.5 truncate">
                      {profileEmail}
                    </p>
                    <p className="text-xs text-slate-600 dark:text-white/70 mt-1 truncate">
                      {profileRole} • {INITIAL_USER.location}
                    </p>
                  </div>
                </div>

                {/* Form Fields */}
                <form onSubmit={handleSaveProfile} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-white/60 block">
                        Full Name
                      </label>
                      <input
                        type="text"
                        value={profileName}
                        onChange={(e) => setProfileName(e.target.value)}
                        className="w-full py-2 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-white/60 block">
                        Contact Email
                      </label>
                      <input
                        type="email"
                        value={profileEmail}
                        onChange={(e) => setProfileEmail(e.target.value)}
                        className="w-full py-2 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-white/60 block">
                      Primary Cognitive Role / Vocation
                    </label>
                    <input
                      type="text"
                      value={profileRole}
                      onChange={(e) => setProfileRole(e.target.value)}
                      className="w-full py-2 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-white/60 block">
                      Personal Context &amp; Objective Bio
                    </label>
                    <textarea
                      rows={3}
                      value={profileBio}
                      onChange={(e) => setProfileBio(e.target.value)}
                      className="w-full p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none leading-relaxed"
                    />
                  </div>

                  <div className="flex items-center gap-3 pt-1">
                    <button
                      type="submit"
                      className="py-2.5 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-medium text-xs shadow-md shadow-indigo-600/30 transition-all cursor-pointer"
                    >
                      Save Profile Updates
                    </button>
                    {profileSaved && (
                      <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px]">check_circle</span>
                        Changes saved and persisted!
                      </span>
                    )}
                  </div>
                </form>
              </div>
            )}

            {/* 2. Settings Section */}
            {activeTab === 'settings' && (
              <div className="space-y-6 max-w-xl">
                <div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                    Assistant Behaviors &amp; Preferences
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-white/60 mt-1">
                    Tune how your Digital Twin interacts, infers context, and executes memory reasoning.
                  </p>
                </div>

                {/* Assistant Tone */}
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 space-y-2">
                  <label className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-white/60 block">
                    Synthesizer Tone
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(['warm', 'direct', 'casual', 'academic'] as const).map((tone) => (
                      <button
                        key={tone}
                        type="button"
                        onClick={() => updatePreferences({ assistantTone: tone })}
                        className={`py-2 px-2.5 rounded-xl text-xs font-medium capitalize border transition-all truncate text-center cursor-pointer ${
                          preferences.assistantTone === tone
                            ? 'bg-indigo-600 text-white border-indigo-500 shadow-md font-semibold'
                            : 'bg-white dark:bg-white/5 text-slate-700 dark:text-white/70 border-slate-200 dark:border-white/10 hover:border-indigo-400/40'
                        }`}
                      >
                        {tone}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Proactivity Level */}
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 space-y-2">
                  <label className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-white/60 block">
                    Proactivity Level
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['subtle', 'balanced', 'expressive'] as const).map((level) => (
                      <button
                        key={level}
                        type="button"
                        onClick={() => updatePreferences({ proactivityLevel: level })}
                        className={`py-2 px-2.5 rounded-xl text-xs font-medium capitalize border transition-all truncate text-center cursor-pointer ${
                          preferences.proactivityLevel === level
                            ? 'bg-indigo-600 text-white border-indigo-500 shadow-md font-semibold'
                            : 'bg-white dark:bg-white/5 text-slate-700 dark:text-white/70 border-slate-200 dark:border-white/10 hover:border-indigo-400/40'
                        }`}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Toggles List */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 gap-3">
                    <div className="min-w-0 flex-1 pr-2">
                      <h4 className="text-sm font-medium text-slate-900 dark:text-white truncate">
                        Autonomous Memory Synthesis
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-white/50 leading-relaxed">
                        Allow Twin to link memories and propose cross-domain insights quietly in the background
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={preferences.autoSynthesis}
                      onChange={(checked) => updatePreferences({ autoSynthesis: checked })}
                      color="indigo"
                      ariaLabel="Autonomous Memory Synthesis"
                    />
                  </div>

                  <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 gap-3">
                    <div className="min-w-0 flex-1 pr-2">
                      <h4 className="text-sm font-medium text-slate-900 dark:text-white truncate">
                        Haptic &amp; Audio Feedback
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-white/50 leading-relaxed">
                        Subtle acoustic feedback for memory captures and synthesized conclusions
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={preferences.soundEffects}
                      onChange={(checked) => updatePreferences({ soundEffects: checked })}
                      color="indigo"
                      ariaLabel="Haptic & Audio Feedback"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 3. Notifications Section (All 7 toggles, responsive, perfectly contained) */}
            {activeTab === 'notifications' && (
              <div className="space-y-6 max-w-xl">
                <div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                    Notification &amp; Synthesis Alerts
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-white/60 mt-1">
                    Control how and when Twin alerts you to recognized cognitive patterns, briefings, and reminders.
                  </p>
                </div>

                {/* Master toggle card */}
                <div className="p-4 rounded-2xl bg-indigo-50/70 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/25 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1 pr-2">
                    <h4 className="font-semibold text-sm text-indigo-950 dark:text-indigo-200 truncate">
                      Master Cognitive Alerts
                    </h4>
                    <p className="text-xs text-indigo-800/80 dark:text-indigo-300/80 mt-0.5 leading-relaxed">
                      Enable all local on-device system notifications and daily thought recaps
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={preferences.masterNotifications}
                    onChange={(checked) => updatePreferences({ masterNotifications: checked })}
                    color="indigo"
                    ariaLabel="Master Cognitive Alerts"
                  />
                </div>

                {/* Individual notification channels */}
                <div className={`space-y-3 transition-opacity ${preferences.masterNotifications ? 'opacity-100' : 'opacity-50'}`}>
                  {/* Channel 1: Morning Briefing */}
                  <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 gap-3">
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[17px] text-amber-500">wb_sunny</span>
                        <h4 className="text-sm font-medium text-slate-900 dark:text-white truncate">
                          Morning Briefing (08:30 AM)
                        </h4>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-white/50 mt-0.5 leading-relaxed">
                        3-point agenda recap with relevant historical context
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={preferences.morningBriefing}
                      onChange={(checked) => updatePreferences({ morningBriefing: checked })}
                      disabled={!preferences.masterNotifications}
                      color="indigo"
                      ariaLabel="Morning Briefing"
                    />
                  </div>

                  {/* Channel 2: Evening Thought Synthesis */}
                  <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 gap-3">
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[17px] text-purple-500">nights_stay</span>
                        <h4 className="text-sm font-medium text-slate-900 dark:text-white truncate">
                          Evening Thought Synthesis (09:00 PM)
                        </h4>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-white/50 mt-0.5 leading-relaxed">
                        Summarizes patterns and cognitive clusters detected during focus hours
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={preferences.eveningRecap}
                      onChange={(checked) => updatePreferences({ eveningRecap: checked })}
                      disabled={!preferences.masterNotifications}
                      color="indigo"
                      ariaLabel="Evening Thought Synthesis"
                    />
                  </div>

                  {/* Channel 3: Pattern Recurrence Alerts */}
                  <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 gap-3">
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[17px] text-indigo-500">hub</span>
                        <h4 className="text-sm font-medium text-slate-900 dark:text-white truncate">
                          Pattern Recurrence Alerts
                        </h4>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-white/50 mt-0.5 leading-relaxed">
                        Triggers when a concept is referenced &gt;3 times across independent notes
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={preferences.patternAlerts}
                      onChange={(checked) => updatePreferences({ patternAlerts: checked })}
                      disabled={!preferences.masterNotifications}
                      color="indigo"
                      ariaLabel="Pattern Recurrence Alerts"
                    />
                  </div>

                  {/* Channel 4: Insight Updates */}
                  <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 gap-3">
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[17px] text-emerald-500">lightbulb</span>
                        <h4 className="text-sm font-medium text-slate-900 dark:text-white truncate">
                          Insight Updates
                        </h4>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-white/50 mt-0.5 leading-relaxed">
                        Notifications when Twin discovers unlinked correlations between projects
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={preferences.insightUpdates}
                      onChange={(checked) => updatePreferences({ insightUpdates: checked })}
                      disabled={!preferences.masterNotifications}
                      color="emerald"
                      ariaLabel="Insight Updates"
                    />
                  </div>

                  {/* Channel 5: Memory Reminders */}
                  <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 gap-3">
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[17px] text-amber-500">alarm</span>
                        <h4 className="text-sm font-medium text-slate-900 dark:text-white truncate">
                          Memory Reminders
                        </h4>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-white/50 mt-0.5 leading-relaxed">
                        Spaced repetition pings for pivotal decisions and scheduled follow-ups
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={preferences.memoryReminders}
                      onChange={(checked) => updatePreferences({ memoryReminders: checked })}
                      disabled={!preferences.masterNotifications}
                      color="amber"
                      ariaLabel="Memory Reminders"
                    />
                  </div>

                  {/* Channel 6: Daily Cognitive Summary */}
                  <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 gap-3">
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[17px] text-indigo-500">analytics</span>
                        <h4 className="text-sm font-medium text-slate-900 dark:text-white truncate">
                          Daily Cognitive Summary
                        </h4>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-white/50 mt-0.5 leading-relaxed">
                        Executive briefing on knowledge clusters expanded and entity links forged
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={preferences.dailySummary}
                      onChange={(checked) => updatePreferences({ dailySummary: checked })}
                      disabled={!preferences.masterNotifications}
                      color="indigo"
                      ariaLabel="Daily Cognitive Summary"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 4. Privacy & Security Section (All controls contained, no overflow, auto-lock fixed) */}
            {activeTab === 'privacy' && (
              <div className="space-y-6 max-w-xl">
                <div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                    Privacy &amp; Security Center
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-white/60 mt-1">
                    Twin operates with a strict zero-telemetry guarantee. Your personal vector embeddings never leave this hardware device.
                  </p>
                </div>

                {/* Status Box */}
                <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-3">
                  <span className="material-symbols-outlined text-emerald-500 dark:text-emerald-400 text-2xl shrink-0 mt-0.5">
                    verified_user
                  </span>
                  <div className="min-w-0">
                    <h4 className="font-semibold text-sm text-emerald-800 dark:text-emerald-300">
                      Zero-Telemetry Local Guarantee Active
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-white/70 mt-0.5 leading-relaxed">
                      All memories, transcripts, decisions, and people dossiers are encrypted locally with AES-256 GCM. Private key ID: <code className="font-mono text-emerald-600 dark:text-emerald-300">{INITIAL_USER.encryptionKeyId}</code>.
                    </p>
                  </div>
                </div>

                {/* Controls List */}
                <div className="space-y-3">
                  {/* Biometric Lock Toggle */}
                  <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 gap-3">
                    <div className="min-w-0 flex-1 pr-2">
                      <h4 className="text-sm font-medium text-slate-900 dark:text-white truncate">
                        Face ID &amp; Biometric Lock
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-white/50 leading-relaxed">
                        Require device authentication to view sensitive memories and decisions
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={preferences.biometricLock}
                      onChange={(checked) => updatePreferences({ biometricLock: checked })}
                      color="indigo"
                      ariaLabel="Face ID & Biometric Lock"
                    />
                  </div>

                  {/* Auto-Lock Session Timeout (Responsive 2x2 on mobile, 4-col on sm+) */}
                  <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 space-y-2">
                    <label className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-white/60 block">
                      Auto-Lock Session Timeout
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full">
                      {(['immediate', '5', '15', 'never'] as const).map((mins) => {
                        const isSelected = preferences.autoLockMinutes === mins;
                        return (
                          <button
                            key={mins}
                            type="button"
                            onClick={() => updatePreferences({ autoLockMinutes: mins })}
                            className={`py-2 px-2.5 rounded-xl text-xs font-medium border transition-all text-center truncate cursor-pointer ${
                              isSelected
                                ? 'bg-indigo-600 text-white border-indigo-500 shadow-md font-semibold ring-2 ring-indigo-500/30'
                                : 'bg-white dark:bg-white/5 text-slate-700 dark:text-white/70 border-slate-200 dark:border-white/10 hover:border-indigo-400/40'
                            }`}
                          >
                            {mins === 'immediate'
                              ? 'Immediate'
                              : mins === 'never'
                              ? 'Never'
                              : `${mins} min`}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Incognito Mode Toggle */}
                  <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 gap-3">
                    <div className="min-w-0 flex-1 pr-2">
                      <h4 className="text-sm font-medium text-slate-900 dark:text-white truncate">
                        Incognito Memory Mode
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-white/50 leading-relaxed">
                        Ask Twin questions without saving the query to your persistent memory stream
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={preferences.incognitoMode}
                      onChange={(checked) => updatePreferences({ incognitoMode: checked })}
                      color="amber"
                      ariaLabel="Incognito Memory Mode"
                    />
                  </div>

                  {/* Microphone Access Toggle */}
                  <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 gap-3">
                    <div className="min-w-0 flex-1 pr-2">
                      <h4 className="text-sm font-medium text-slate-900 dark:text-white truncate">
                        Microphone Dictation Permission
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-white/50 leading-relaxed">
                        Used only during active voice capture; zero passive ambient listening
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={preferences.micAccess}
                      onChange={(checked) => updatePreferences({ micAccess: checked })}
                      color="emerald"
                      ariaLabel="Microphone Dictation Permission"
                    />
                  </div>

                  {/* Data Retention Period */}
                  <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 space-y-2">
                    <label className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-white/60 block">
                      Local Vector Retention Lifespan
                    </label>
                    <div className="grid grid-cols-3 gap-2 w-full">
                      {[
                        { id: 'forever', label: 'Indefinite' },
                        { id: '1year', label: '1 Year' },
                        { id: '90days', label: '90 Days' },
                      ].map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => updatePreferences({ retentionPeriod: item.id as any })}
                          className={`py-2 px-2.5 rounded-xl text-xs font-medium border transition-all text-center truncate cursor-pointer ${
                            preferences.retentionPeriod === item.id
                              ? 'bg-indigo-600 text-white border-indigo-500 shadow-md font-semibold ring-2 ring-indigo-500/30'
                              : 'bg-white dark:bg-white/5 text-slate-700 dark:text-white/70 border-slate-200 dark:border-white/10 hover:border-indigo-400/40'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 5. Memory & Data Section */}
            {activeTab === 'data' && (
              <div className="space-y-6 max-w-xl">
                <div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                    Memory &amp; Data Management
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-white/60 mt-1">
                    Inspect your local vector storage quotas, export full offline archives, or purge historical seeds.
                  </p>
                </div>

                {/* Storage Breakdown */}
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-slate-500 dark:text-white/60 uppercase tracking-wider">
                      Local Vector Quota
                    </span>
                    <span className="text-xs font-mono text-indigo-600 dark:text-indigo-400 font-semibold">
                      16.2 MB / 500 MB (3.2%)
                    </span>
                  </div>
                  {/* Progress Bar */}
                  <div className="h-2 w-full bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden flex">
                    <div className="h-full bg-indigo-500 w-[18%]" title="Projects (6.8 MB)" />
                    <div className="h-full bg-purple-500 w-[12%]" title="Ideas (4.2 MB)" />
                    <div className="h-full bg-amber-500 w-[9%]" title="Decisions (3.1 MB)" />
                    <div className="h-full bg-emerald-500 w-[6%]" title="People (2.1 MB)" />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px] font-mono text-slate-500 dark:text-white/60">
                    <span className="flex items-center gap-1.5 truncate">
                      <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" /> Projects (6.8M)
                    </span>
                    <span className="flex items-center gap-1.5 truncate">
                      <span className="w-2 h-2 rounded-full bg-purple-500 shrink-0" /> Ideas (4.2M)
                    </span>
                    <span className="flex items-center gap-1.5 truncate">
                      <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" /> Decisions (3.1M)
                    </span>
                    <span className="flex items-center gap-1.5 truncate">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" /> People (2.1M)
                    </span>
                  </div>
                </div>

                {/* Export Options */}
                <div className="space-y-3">
                  <h4 className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-white/60">
                    Data Export (Offline Portable Format)
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => handleExportData('json')}
                      className="p-3.5 rounded-2xl bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-left transition-all group flex items-start gap-3 cursor-pointer"
                    >
                      <div className="w-8 h-8 rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                        <span className="material-symbols-outlined text-[19px]">data_object</span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white truncate">
                          Export JSON Graph
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-white/50 mt-0.5 truncate">
                          Full schema with weights &amp; embeddings
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleExportData('markdown')}
                      className="p-3.5 rounded-2xl bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-left transition-all group flex items-start gap-3 cursor-pointer"
                    >
                      <div className="w-8 h-8 rounded-xl bg-purple-500/15 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                        <span className="material-symbols-outlined text-[19px]">description</span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white truncate">
                          Export Markdown Notes
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-white/50 mt-0.5 truncate">
                          Readable vault memos and transcripts
                        </p>
                      </div>
                    </button>
                  </div>

                  {exportStatus && (
                    <div className="p-3 rounded-xl bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 font-mono text-xs text-center border border-indigo-500/30">
                      {exportStatus}
                    </div>
                  )}
                </div>

                {/* Reset Vault Danger Zone */}
                <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/25 space-y-3">
                  <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-semibold text-sm">
                    <span className="material-symbols-outlined text-[18px]">warning</span>
                    Vault Danger Zone
                  </div>
                  <p className="text-xs text-rose-700 dark:text-rose-300/80 leading-relaxed">
                    Resetting will restore all knowledge clusters, chat suggestions, and decisions back to the initial demonstration state.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm('Are you certain you want to reset your Twin Vault back to initial demonstration state?')) {
                        onResetVault();
                        onClose();
                      }
                    }}
                    className="py-2 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow transition-all active:scale-95 cursor-pointer"
                  >
                    Reset Vault to Defaults
                  </button>
                </div>
              </div>
            )}

            {/* 6. Appearance Section (Immediately updates global theme/accents/glass) */}
            {activeTab === 'appearance' && (
              <div className="space-y-6 max-w-xl">
                <div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                    Appearance &amp; Visual Atmosphere
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-white/60 mt-1">
                    Customize the Twin aesthetic atmosphere. Seamlessly switch between dark, light, or system matching modes.
                  </p>
                </div>

                {/* Theme Selector */}
                <div className="space-y-2">
                  <label className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-white/60 block">
                    Color Theme Mode
                  </label>
                  <div className="grid grid-cols-3 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setThemePreference('light')}
                      className={`p-3.5 rounded-2xl border flex flex-col items-center gap-2 transition-all cursor-pointer ${
                        themePreference === 'light'
                          ? 'bg-white text-slate-900 border-indigo-500 ring-2 ring-indigo-500/40 shadow-lg'
                          : 'bg-white dark:bg-white/5 text-slate-700 dark:text-white/70 border-slate-200 dark:border-white/10 hover:border-indigo-400/40'
                      }`}
                    >
                      <span className="material-symbols-outlined text-2xl text-amber-500">light_mode</span>
                      <span className="text-xs font-semibold">Light</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setThemePreference('dark')}
                      className={`p-3.5 rounded-2xl border flex flex-col items-center gap-2 transition-all cursor-pointer ${
                        themePreference === 'dark'
                          ? 'bg-indigo-600 text-white border-indigo-400 ring-2 ring-indigo-500/40 shadow-lg'
                          : 'bg-white dark:bg-white/5 text-slate-700 dark:text-white/70 border-slate-200 dark:border-white/10 hover:border-indigo-400/40'
                      }`}
                    >
                      <span className="material-symbols-outlined text-2xl text-indigo-300">dark_mode</span>
                      <span className="text-xs font-semibold">Dark</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setThemePreference('system')}
                      className={`p-3.5 rounded-2xl border flex flex-col items-center gap-2 transition-all cursor-pointer ${
                        themePreference === 'system'
                          ? 'bg-gradient-to-r from-slate-700 to-slate-900 text-white border-indigo-400 ring-2 ring-indigo-500/40 shadow-lg'
                          : 'bg-white dark:bg-white/5 text-slate-700 dark:text-white/70 border-slate-200 dark:border-white/10 hover:border-indigo-400/40'
                      }`}
                    >
                      <span className="material-symbols-outlined text-2xl text-slate-400">settings_brightness</span>
                      <span className="text-xs font-semibold">System Auto</span>
                    </button>
                  </div>
                </div>

                {/* Frosted Glass Refraction Level */}
                <div className="space-y-2">
                  <label className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-white/60 block">
                    Frosted Glass Refraction
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['subtle', 'balanced', 'deep'] as const).map((level) => (
                      <button
                        key={level}
                        type="button"
                        onClick={() => setFrostedIntensity(level)}
                        className={`py-2 px-3 rounded-xl text-xs font-medium capitalize border transition-all cursor-pointer text-center truncate ${
                          frostedIntensity === level
                            ? 'bg-indigo-600 text-white border-indigo-500 shadow-md font-semibold ring-2 ring-indigo-500/30'
                            : 'bg-white dark:bg-white/5 text-slate-700 dark:text-white/70 border-slate-200 dark:border-white/10 hover:border-indigo-400/40'
                        }`}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Accent Colors */}
                <div className="space-y-2">
                  <label className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-white/60 block">
                    Primary Neural Accent
                  </label>
                  <div className="flex items-center gap-3">
                    {[
                      { id: 'indigo', bg: 'bg-indigo-500', name: 'Cosmic Indigo' },
                      { id: 'violet', bg: 'bg-purple-500', name: 'Deep Violet' },
                      { id: 'emerald', bg: 'bg-emerald-500', name: 'Emerald Glow' },
                      { id: 'amber', bg: 'bg-amber-500', name: 'Amber Flame' },
                    ].map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setAccentColor(c.id as AccentColor)}
                        className={`w-10 h-10 rounded-full ${c.bg} flex items-center justify-center transition-all cursor-pointer ${
                          accentColor === c.id
                            ? 'ring-4 ring-indigo-500/40 scale-110 shadow-lg'
                            : 'opacity-70 hover:opacity-100 hover:scale-105'
                        }`}
                        title={c.name}
                        aria-label={`Select ${c.name} accent`}
                      >
                        {accentColor === c.id && (
                          <span className="material-symbols-outlined text-white text-[18px]">check</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 7. Help & About Section */}
            {activeTab === 'about' && (
              <div className="space-y-6 max-w-xl">
                <div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                    Twin Intelligence v4.2.1
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-white/60 mt-1">
                    An evolving, zero-telemetry personal intelligence system built for private high-velocity cognition.
                  </p>
                </div>

                {/* Core Architecture Manifesto */}
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 space-y-3">
                  <div className="flex items-center gap-2">
                    <img
                      src={INITIAL_USER.twinSymbolUrl}
                      alt="Twin Core"
                      className="w-5 h-5 object-contain"
                    />
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Twin Core Philosophy
                    </h4>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-white/70 leading-relaxed">
                    Unlike conventional cloud assistants that send your private thoughts to centralized servers, Twin runs localized vector clustering and graph relationship reasoning right in your browser runtime.
                  </p>
                  <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] font-mono text-indigo-600 dark:text-indigo-300">
                    <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20">
                      ✓ Zero Cloud Telemetry
                    </div>
                    <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20">
                      ✓ Instant Local Recall
                    </div>
                  </div>
                </div>

                {/* Keyboard Shortcuts Reference */}
                <div className="space-y-2">
                  <h4 className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-white/60">
                    Keyboard Shortcuts
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                      <span>Quick Search / Memory Recall</span>
                      <kbd className="font-mono bg-slate-200 dark:bg-white/10 px-2 py-0.5 rounded text-[10px]">⌘K</kbd>
                    </div>
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                      <span>Quick Memory Capture</span>
                      <kbd className="font-mono bg-slate-200 dark:bg-white/10 px-2 py-0.5 rounded text-[10px]">⌘N</kbd>
                    </div>
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                      <span>Toggle Theme</span>
                      <kbd className="font-mono bg-slate-200 dark:bg-white/10 px-2 py-0.5 rounded text-[10px]">⌘T</kbd>
                    </div>
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                      <span>Dismiss Dialog / Popover</span>
                      <kbd className="font-mono bg-slate-200 dark:bg-white/10 px-2 py-0.5 rounded text-[10px]">Esc</kbd>
                    </div>
                  </div>
                </div>

                {/* System Diagnostics */}
                <div className="p-3 rounded-xl bg-slate-100 dark:bg-black/40 border border-slate-200 dark:border-white/10 text-[11px] font-mono text-slate-600 dark:text-white/50 space-y-1">
                  <div className="flex justify-between">
                    <span>Node Build:</span>
                    <span className="text-slate-900 dark:text-white font-medium">v4.2.1-prod-2026</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Active Gateway:</span>
                    <span className="text-slate-900 dark:text-white font-medium">NY-042 (Local Sandboxed)</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Encryption Engine:</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">AES-256 GCM (Hardware-backed)</span>
                  </div>
                </div>
              </div>
            )}

            {/* 8. Sign Out Confirmation Section */}
            {activeTab === 'signout' && (
              <div className="space-y-6 max-w-xl">
                <div className="p-5 rounded-3xl bg-rose-500/10 border border-rose-500/30 text-center space-y-3">
                  <div className="w-14 h-14 rounded-full bg-rose-500/20 text-rose-500 dark:text-rose-400 flex items-center justify-center mx-auto shadow-inner">
                    <span className="material-symbols-outlined text-3xl">lock</span>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                      Lock Vault &amp; Sign Out?
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-white/70 mt-1 max-w-sm mx-auto leading-relaxed">
                      Signing out locks your on-device cryptographic encryption keys. To resume using your Twin memories and context graph, you will return to the sign-in screen.
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-3 pt-3">
                    <button
                      type="button"
                      onClick={() => setActiveTab('profile')}
                      className="py-2.5 px-5 rounded-2xl bg-slate-200 dark:bg-white/10 hover:bg-slate-300 dark:hover:bg-white/15 text-xs sm:text-sm font-medium text-slate-800 dark:text-white transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleExecuteSignOut}
                      className="py-2.5 px-6 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white text-xs sm:text-sm font-semibold shadow-lg shadow-rose-600/40 transition-all active:scale-95 cursor-pointer"
                    >
                      Yes, Lock &amp; Sign Out
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
