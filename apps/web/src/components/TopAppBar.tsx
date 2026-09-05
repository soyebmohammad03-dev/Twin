import React, { useState, useRef } from 'react';
import { TabType, ThemeMode, ThemePreference, AccountSection } from '../types';
import { INITIAL_USER } from '../data/mockData';
import { AccountMenu } from './AccountMenu';
import { NotificationCenter } from './NotificationCenter';
import { useApp } from '../context/AppContext';

interface TopAppBarProps {
  currentTab: TabType;
  theme: ThemeMode;
  themePreference: ThemePreference;
  onSelectTheme: (pref: ThemePreference) => void;
  onToggleTheme: () => void;
  onOpenSearch: () => void;
  onOpenCapture: () => void;
  onSelectTab: (tab: TabType) => void;
  onOpenAccountSection: (section: AccountSection) => void;
  onOpenInsight: (insightId: string) => void;
}

export const TopAppBar: React.FC<TopAppBarProps> = ({
  theme,
  themePreference,
  onSelectTheme,
  onToggleTheme,
  onOpenSearch,
  onOpenCapture,
  onSelectTab,
  onOpenAccountSection,
  onOpenInsight,
}) => {
  const { userProfile } = useApp();
  const isDark = theme === 'dark';
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);

  const activeAvatar = isDark
    ? userProfile?.avatarUrl || INITIAL_USER.avatarUrl
    : userProfile?.lightAvatarUrl || userProfile?.avatarUrl || INITIAL_USER.lightAvatarUrl;
  const activeName = userProfile?.name || INITIAL_USER.name;

  return (
    <header className="fixed top-0 left-0 right-0 z-45 h-16 w-full border-b border-slate-200/90 dark:border-white/10 bg-white/85 dark:bg-white/5 backdrop-blur-xl flex items-center justify-between px-4 sm:px-8 transition-colors duration-300">
      {/* Leading: Brand with Glowing Gradient Emblem */}
      <button
        onClick={() => onSelectTab('home')}
        className="flex items-center gap-3 group cursor-pointer focus:outline-none shrink-0"
      >
        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-[0_0_15px_rgba(99,102,241,0.5)] transition-transform group-hover:scale-105">
          <div className="w-4 h-4 rounded-full border-2 border-white/90 flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          </div>
        </div>
        <span className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
          Twin
        </span>
      </button>

      {/* Center: Frosted Search Input Bar */}
      <div className="flex-1 max-w-sm sm:max-w-md mx-3 sm:mx-8 hidden md:block">
        <div
          onClick={onOpenSearch}
          className="relative group cursor-pointer"
        >
          <div className="w-full bg-slate-100/90 dark:bg-white/10 hover:bg-slate-200/70 dark:hover:bg-white/15 border border-slate-200 dark:border-white/10 rounded-full py-1.5 px-9 text-xs sm:text-sm text-slate-800 dark:text-white transition-all flex items-center justify-between shadow-xs">
            <span className="text-slate-500 dark:text-white/50 text-xs sm:text-sm">Recall a memory or project...</span>
            <span className="text-[10px] font-mono uppercase bg-slate-200/80 dark:bg-white/10 px-2 py-0.5 rounded-full text-slate-600 dark:text-white/60">⌘K</span>
          </div>
          <svg
            className="w-4 h-4 absolute left-3.5 top-2.5 text-slate-400 dark:text-white/40 group-hover:text-slate-700 dark:group-hover:text-white/70 transition-colors"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      {/* Trailing: Sync Status Pill, Capture, Theme Switcher & Interactive Avatar Menu */}
      <div className="flex items-center gap-2 sm:gap-3.5 relative">
        {/* Syncing Status Indicator Pill */}
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-slate-100/90 dark:bg-white/10 rounded-full border border-slate-200 dark:border-white/10 shadow-xs">
          <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981] animate-pulse"></div>
          <span className="text-xs font-medium text-slate-700 dark:text-white/80">Syncing: 98%</span>
        </div>

        {/* Mobile Search Button */}
        <button
          onClick={onOpenSearch}
          className="md:hidden w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/80 hover:bg-slate-200 dark:hover:bg-white/20 transition-all active:scale-95 cursor-pointer"
          title="Search memories"
        >
          <span className="material-symbols-outlined text-[18px]">search</span>
        </button>

        {/* Quick Capture Button */}
        <button
          onClick={onOpenCapture}
          className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-800 dark:text-white hover:bg-slate-200 dark:hover:bg-white/20 transition-all active:scale-95 shadow-xs cursor-pointer"
          title="Capture memory or thought"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
        </button>

        {/* Notifications */}
        <NotificationCenter onOpenInsight={onOpenInsight} />

        {/* Theme Toggle */}
        <button
          onClick={onToggleTheme}
          className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/70 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/15 transition-all active:scale-95 cursor-pointer"
          title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          <span className="material-symbols-outlined text-[17px]">
            {isDark ? 'light_mode' : 'dark_mode'}
          </span>
        </button>

        {/* Interactive Top-Right Account Avatar Button */}
        <div className="relative">
          <button
            ref={avatarButtonRef}
            id="header-profile-avatar-btn"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsAccountMenuOpen((prev) => !prev);
            }}
            aria-label="Open profile menu"
            aria-haspopup="menu"
            aria-expanded={isAccountMenuOpen}
            aria-controls="profile-account-popover"
            className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center overflow-hidden active:scale-95 transition-all shadow-md group relative cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              isAccountMenuOpen
                ? 'ring-2 ring-indigo-500 border-2 border-indigo-500 scale-105'
                : 'border-2 border-slate-300/80 dark:border-white/20 hover:border-indigo-500 dark:hover:border-indigo-400'
            }`}
            title="Open profile menu"
          >
            <img
              src={activeAvatar}
              alt={`${activeName} Account`}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>

          {/* Account Popover Menu */}
          <AccountMenu
            isOpen={isAccountMenuOpen}
            anchorRef={avatarButtonRef}
            onClose={() => setIsAccountMenuOpen(false)}
            onNavigateToProfile={() => {
              setIsAccountMenuOpen(false);
              onSelectTab('profile');
            }}
            onSelectSection={onOpenAccountSection}
            themePreference={themePreference}
            onSelectTheme={onSelectTheme}
            resolvedTheme={theme}
          />
        </div>
      </div>
    </header>
  );
};

