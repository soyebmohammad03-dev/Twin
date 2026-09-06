import React, { useState, useEffect } from 'react';
import { AccountSection, ThemePreference, ThemeMode, AccentColor, FrostedIntensity } from '../types';
import { INITIAL_USER } from '../data/mockData';
import { useApp } from '../context/AppContext';
import { API_BASE_URL } from '../services/authService';
import { ToggleSwitch } from './ToggleSwitch';
import { NotificationSettingsSection } from './NotificationSettingsSection';
import { useEscapeToClose } from '../hooks/useEscapeToClose';

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

  useEscapeToClose(onClose, isOpen);
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
    // Honest scope: this exports the profile/preference settings
    // stored in this browser, not the user's actual memories,
    // decisions, or insights (those live server-side and have no
    // export endpoint yet — see the real Twin API). Never claims
    // "encrypted" for what is, in fact, a plain-text download.
    setExportStatus(`Preparing ${format.toUpperCase()} file...`);
    setTimeout(() => {
      const content =
        format === 'json'
          ? JSON.stringify(
              {
                user: { ...INITIAL_USER, ...userProfile },
                preferences,
                exportedAt: new Date().toISOString(),
              },
              null,
              2
            )
          : `# Twin Profile Export\n\nUser: ${profileName} (${profileEmail})\nRole: ${profileRole}\nDate: ${new Date().toLocaleDateString()}\n\n## Bio\n${profileBio}\n\nNote: this file contains your local profile settings only — it does not include your memories, decisions, or insights, which are stored server-side.\n`;

      const blob = new Blob([content], {
        type: format === 'json' ? 'application/json' : 'text/markdown',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `twin-profile-export-${new Date().toISOString().slice(0, 10)}.${
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
              Signed in
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
                    </div>
                    <p className="text-xs text-slate-500 dark:text-white/50 font-mono mt-0.5 truncate">
                      {profileEmail}
                    </p>
                    {profileRole && (
                      <p className="text-xs text-slate-600 dark:text-white/70 mt-1 truncate">
                        {profileRole}
                      </p>
                    )}
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
                    Saved for when Twin Chat can adapt its tone and proactivity to your preference — not yet applied to responses.
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
                        Memory Synthesis
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-white/50 leading-relaxed">
                        Let Twin re-scan your memories for Insights each time you open your Profile
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={preferences.autoSynthesis}
                      onChange={(checked) => updatePreferences({ autoSynthesis: checked })}
                      color="indigo"
                      ariaLabel="Memory Synthesis"
                    />
                  </div>

                  <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 gap-3">
                    <div className="min-w-0 flex-1 pr-2">
                      <h4 className="text-sm font-medium text-slate-900 dark:text-white truncate">
                        Haptic &amp; Audio Feedback
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-white/50 leading-relaxed">
                        Saved for when sound effects ship — not yet played anywhere
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

            {/* 3. Notifications Section — honest: Twin has no notification delivery (no email/push) yet.
                 This used to offer six individually-toggleable "channels" (a scheduled morning
                 briefing, pattern-recurrence alerts, spaced-repetition reminders, etc.) with
                 specific invented behavior — none of it existed anywhere in the backend. Rather
                 than leave fabricated feature descriptions in place, this is now a single honest
                 opt-in preference with no channels to configure until real delivery exists. */}
            {activeTab === 'notifications' && (
              <div className="space-y-6 max-w-xl">
                <div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                    Notifications
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-white/60 mt-1">
                    Real, evidence-backed notifications only — never a fabricated alert.
                  </p>
                </div>
                <NotificationSettingsSection />
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
                    Twin does not run analytics or telemetry, and never shares your data with third parties or ad networks.
                  </p>
                </div>

                {/* Status Box */}
                <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-3">
                  <span className="material-symbols-outlined text-emerald-500 dark:text-emerald-400 text-2xl shrink-0 mt-0.5">
                    verified_user
                  </span>
                  <div className="min-w-0">
                    <h4 className="font-semibold text-sm text-emerald-800 dark:text-emerald-300">
                      Account access is scoped to you
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-white/70 mt-0.5 leading-relaxed">
                      Every memory, decision, and connection in your account is checked against your signed-in identity — no other account can read or modify it. Twin does not share your data with third parties or ad networks.
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
                      Memory Retention Period
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
                    Export your data, or clear the local Twin Chat cache below.
                  </p>
                </div>

                {/* Export Options — profile/preferences only; memories, decisions, and insights live server-side and have no export endpoint yet */}
                <div className="space-y-3">
                  <h4 className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-white/60">
                    Export Profile Settings
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
                          Export as JSON
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-white/50 mt-0.5 truncate">
                          Profile &amp; preference settings on this device
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
                          Export as Markdown
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-white/50 mt-0.5 truncate">
                          Readable summary of your profile settings
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

                {/* Clear cached Twin Chat history — a local UI cache only, never memories/decisions/insights, which live server-side and aren't touched by this */}
                <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/25 space-y-3">
                  <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-semibold text-sm">
                    <span className="material-symbols-outlined text-[18px]">warning</span>
                    Clear Twin Chat History
                  </div>
                  <p className="text-xs text-rose-700 dark:text-rose-300/80 leading-relaxed">
                    Clears your cached Twin Chat conversation on this device. Your memories, Personal Model, insights, and decisions are stored server-side and are not affected.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm('Clear your cached Twin Chat conversation on this device?')) {
                        onResetVault();
                        onClose();
                      }
                    }}
                    className="py-2 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow transition-all active:scale-95 cursor-pointer"
                  >
                    Clear Chat History
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
                    About Twin
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-white/60 mt-1">
                    An evolving, evidence-grounded model of your world — not an AI pretending to be you.
                  </p>
                </div>

                {/* Core Architecture Philosophy */}
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
                    Every fact in your Personal Model, every insight, and every answer in Twin Chat traces back to a real memory you provided — nothing is inferred without evidence you can inspect.
                  </p>
                  <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] font-mono text-indigo-600 dark:text-indigo-300">
                    <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20">
                      ✓ No Third-Party Tracking
                    </div>
                    <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20">
                      ✓ Evidence-Backed Answers
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

                {/* System Info — real, verifiable values only (build mode from Vite, the actual configured API endpoint) */}
                <div className="p-3 rounded-xl bg-slate-100 dark:bg-black/40 border border-slate-200 dark:border-white/10 text-[11px] font-mono text-slate-600 dark:text-white/50 space-y-1">
                  <div className="flex justify-between">
                    <span>Build Mode:</span>
                    <span className="text-slate-900 dark:text-white font-medium">{import.meta.env.MODE}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="shrink-0">API Endpoint:</span>
                    <span className="text-slate-900 dark:text-white font-medium truncate">{API_BASE_URL}</span>
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
                      Sign Out?
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-white/70 mt-1 max-w-sm mx-auto leading-relaxed">
                      Your memories and context graph stay safely stored on the server. Sign back in any time to pick up where you left off.
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
                      Yes, Sign Out
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
