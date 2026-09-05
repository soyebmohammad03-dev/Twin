import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AccountSection, ThemePreference, ThemeMode } from '../types';
import { INITIAL_USER } from '../data/mockData';
import { useApp } from '../context/AppContext';

interface AccountMenuProps {
  isOpen: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onNavigateToProfile: () => void;
  onSelectSection: (section: AccountSection) => void;
  themePreference: ThemePreference;
  onSelectTheme: (pref: ThemePreference) => void;
  resolvedTheme: ThemeMode;
}

interface PopoverCoords {
  top: number;
  right: number;
  width: number;
  maxHeight: number;
}

export const AccountMenu: React.FC<AccountMenuProps> = ({
  isOpen,
  anchorRef,
  onClose,
  onNavigateToProfile,
  onSelectSection,
  themePreference,
  onSelectTheme,
  resolvedTheme,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const isDark = resolvedTheme === 'dark';
  const { userProfile } = useApp();

  // Calculate dynamic anchored position based on avatar bounding rect
  const calculateCoords = useCallback((): PopoverCoords | null => {
    if (!anchorRef?.current || typeof window === 'undefined') return null;
    const rect = anchorRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Viewport margin: 8px for ultra-compact devices (<360px), 12px for standard mobile & desktop
    const margin = viewportWidth < 360 ? 8 : 12;

    // Menu width: capped at 340px, but always constrained to fit within viewport with margins
    const menuWidth = Math.min(340, viewportWidth - margin * 2);

    // Vertical anchoring: directly below avatar button with an 8px offset
    const top = Math.round(rect.bottom + 8);

    // Safe vertical boundary: ensure menu fits within visible viewport
    const availableHeight = viewportHeight - top - margin;
    const maxHeight = Math.max(260, Math.min(540, availableHeight));

    // Horizontal anchoring:
    // Align the right edge of the popover with the right edge of the avatar button.
    let right = Math.round(viewportWidth - rect.right);

    // Keep right edge at least `margin` pixels from viewport right edge
    right = Math.max(margin, right);

    // Keep left edge at least `margin` pixels from viewport left edge
    if (viewportWidth - right - menuWidth < margin) {
      right = Math.max(margin, viewportWidth - menuWidth - margin);
    }

    return {
      top,
      right,
      width: menuWidth,
      maxHeight,
    };
  }, [anchorRef]);

  const [coords, setCoords] = useState<PopoverCoords | null>(() => calculateCoords());

  const updateCoords = useCallback(() => {
    const nextCoords = calculateCoords();
    if (nextCoords) {
      setCoords(nextCoords);
    }
  }, [calculateCoords]);

  // Synchronously compute position immediately when opened before browser paint
  useLayoutEffect(() => {
    if (isOpen) {
      updateCoords();
    }
  }, [isOpen, updateCoords]);

  // Recalculate dynamically on window resize or scroll
  useEffect(() => {
    if (!isOpen) return;

    updateCoords();

    window.addEventListener('resize', updateCoords, { passive: true });
    window.addEventListener('scroll', updateCoords, { passive: true });

    return () => {
      window.removeEventListener('resize', updateCoords);
      window.removeEventListener('scroll', updateCoords);
    };
  }, [isOpen, updateCoords]);

  // Close on Outside Click or Escape key press
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      // Do not close if clicking inside menu or directly on the anchor avatar button
      if (menuRef.current?.contains(target) || anchorRef?.current?.contains(target)) {
        return;
      }
      onClose();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        anchorRef?.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, anchorRef]);

  if (!isOpen || typeof document === 'undefined') return null;

  const handleProfileClick = () => {
    onClose();
    onNavigateToProfile();
  };

  const handleItemClick = (section: AccountSection) => {
    onClose();
    onSelectSection(section);
  };

  return createPortal(
    <>
      {/* Backdrop: Sits between Header (z-45) and Popover (z-[55]) at z-[52] to catch outside clicks */}
      <div
        className="fixed inset-0 z-[52] bg-black/15 dark:bg-black/30 backdrop-blur-[0.5px] transition-opacity duration-200"
        aria-hidden="true"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />

      {/* Floating Popover Container: Anchored dynamically to avatar, rendered in document.body */}
      <div
        ref={menuRef}
        id="profile-account-popover"
        role="menu"
        aria-label="Profile and account menu"
        aria-modal="true"
        style={{
          top: coords ? `${coords.top}px` : undefined,
          right: coords ? `${coords.right}px` : undefined,
          width: coords ? `${coords.width}px` : '340px',
          maxHeight: coords ? `${coords.maxHeight}px` : '80vh',
          transformOrigin: 'top right',
        }}
        className={`fixed z-[55] transition-all duration-200 ease-out
          rounded-2xl sm:rounded-3xl
          bg-white/95 dark:bg-[#0c0d14]/95
          border border-slate-200/90 dark:border-white/15
          backdrop-blur-2xl shadow-2xl shadow-slate-900/20 dark:shadow-black/80
          flex flex-col overflow-hidden text-slate-900 dark:text-white
          ${coords ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}
        `}
      >
        {/* 1. User Identity Header (Tapping navigates to personal profile) */}
        <div
          onClick={handleProfileClick}
          className="p-3.5 sm:p-4 border-b border-slate-100 dark:border-white/10 flex items-start justify-between gap-3 bg-slate-50/80 dark:bg-white/[0.03] hover:bg-slate-100/80 dark:hover:bg-white/[0.06] transition-colors cursor-pointer group shrink-0"
          title="View Digital Twin Profile"
          role="menuitem"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleProfileClick();
            }
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            {/* Avatar with Pro Ring */}
            <div className="relative shrink-0">
              <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-full overflow-hidden border-2 border-indigo-500/60 shadow-md group-hover:scale-105 transition-transform">
                <img
                  src={
                    isDark
                      ? userProfile?.avatarUrl || INITIAL_USER.avatarUrl
                      : userProfile?.lightAvatarUrl || userProfile?.avatarUrl || INITIAL_USER.lightAvatarUrl
                  }
                  alt={userProfile?.name || INITIAL_USER.name}
                  className="w-full h-full object-cover"
                />
              </div>
              <span
                className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-white dark:border-[#0d0e15] shadow-[0_0_8px_#34d399]"
                title="Account Synced & Active"
              />
            </div>

            {/* Name, Email, Status */}
            <div className="min-w-0 flex flex-col">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <span className="font-semibold text-sm sm:text-base text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                  {userProfile?.name || INITIAL_USER.name}
                </span>
                <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30 shrink-0">
                  PRO
                </span>
              </div>
              <span className="text-xs text-slate-500 dark:text-white/50 truncate font-mono mt-0.5">
                {userProfile?.email || INITIAL_USER.email}
              </span>
              <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <span className="truncate">On-Device Vault Synced</span>
              </div>
            </div>
          </div>

          {/* Close button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-800 dark:text-white/40 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10 transition-colors cursor-pointer shrink-0"
            title="Close menu"
            aria-label="Close menu"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Scrollable Navigation Sections */}
        <div className="flex-1 overflow-y-auto py-2 px-2.5 space-y-1 min-h-0">
          {/* Action 1: Profile */}
          <button
            type="button"
            role="menuitem"
            onClick={handleProfileClick}
            className="w-full flex items-center justify-between p-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-white/10 active:scale-[0.98] transition-all group text-left cursor-pointer"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center transition-transform group-hover:scale-110 shrink-0">
                <span className="material-symbols-outlined text-[19px]">person</span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-white leading-tight group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors truncate">
                  Profile
                </p>
                <p className="text-[11px] text-slate-500 dark:text-white/40 leading-tight mt-0.5 truncate">
                  View personal model &amp; digital twin
                </p>
              </div>
            </div>
            <span className="material-symbols-outlined text-slate-400 dark:text-white/30 group-hover:text-slate-900 dark:group-hover:text-white group-hover:translate-x-0.5 transition-all text-sm shrink-0">
              chevron_right
            </span>
          </button>

          {/* Action 2: Settings */}
          <button
            type="button"
            role="menuitem"
            onClick={() => handleItemClick('settings')}
            className="w-full flex items-center justify-between p-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-white/10 active:scale-[0.98] transition-all group text-left cursor-pointer"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-purple-500/15 text-purple-600 dark:text-purple-400 flex items-center justify-center transition-transform group-hover:scale-110 shrink-0">
                <span className="material-symbols-outlined text-[19px]">tune</span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-white leading-tight truncate">
                  Settings
                </p>
                <p className="text-[11px] text-slate-500 dark:text-white/40 leading-tight mt-0.5 truncate">
                  Assistant behaviors &amp; preferences
                </p>
              </div>
            </div>
            <span className="material-symbols-outlined text-slate-400 dark:text-white/30 group-hover:text-slate-900 dark:group-hover:text-white group-hover:translate-x-0.5 transition-all text-sm shrink-0">
              chevron_right
            </span>
          </button>

          {/* Action 3: Notifications */}
          <button
            type="button"
            role="menuitem"
            onClick={() => handleItemClick('notifications')}
            className="w-full flex items-center justify-between p-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-white/10 active:scale-[0.98] transition-all group text-left cursor-pointer"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center transition-transform group-hover:scale-110 shrink-0">
                <span className="material-symbols-outlined text-[19px]">notifications</span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-white leading-tight truncate">
                  Notifications
                </p>
                <p className="text-[11px] text-slate-500 dark:text-white/40 leading-tight mt-0.5 truncate">
                  Synthesis alerts &amp; briefings
                </p>
              </div>
            </div>
            <span className="material-symbols-outlined text-slate-400 dark:text-white/30 group-hover:text-slate-900 dark:group-hover:text-white group-hover:translate-x-0.5 transition-all text-sm shrink-0">
              chevron_right
            </span>
          </button>

          {/* Action 4: Privacy & Memory Controls */}
          <button
            type="button"
            role="menuitem"
            onClick={() => handleItemClick('privacy')}
            className="w-full flex items-center justify-between p-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-white/10 active:scale-[0.98] transition-all group text-left cursor-pointer"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center transition-transform group-hover:scale-110 shrink-0">
                <span className="material-symbols-outlined text-[19px]">shield_lock</span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-white leading-tight truncate">
                  Privacy &amp; Memory Controls
                </p>
                <p className="text-[11px] text-slate-500 dark:text-white/40 leading-tight mt-0.5 truncate">
                  Biometric vault, export &amp; retention
                </p>
              </div>
            </div>
            <span className="material-symbols-outlined text-slate-400 dark:text-white/30 group-hover:text-slate-900 dark:group-hover:text-white group-hover:translate-x-0.5 transition-all text-sm shrink-0">
              chevron_right
            </span>
          </button>

          {/* Action 5: Appearance (Theme Controls) */}
          <div className="p-2.5 rounded-2xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200/80 dark:border-white/5 my-1">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-indigo-600 dark:text-indigo-400 text-[18px]">
                  palette
                </span>
                <span className="text-xs font-semibold text-slate-800 dark:text-white/90">
                  Appearance
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleItemClick('appearance')}
                className="text-[11px] text-indigo-600 dark:text-indigo-300 hover:underline font-mono cursor-pointer"
              >
                More
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-200/70 dark:bg-black/40 rounded-xl border border-slate-300/50 dark:border-white/5">
              <button
                type="button"
                onClick={() => onSelectTheme('light')}
                className={`py-1.5 px-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  themePreference === 'light'
                    ? 'bg-white text-slate-900 shadow-sm font-semibold'
                    : 'text-slate-600 dark:text-white/60 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">light_mode</span>
                <span>Light</span>
              </button>
              <button
                type="button"
                onClick={() => onSelectTheme('dark')}
                className={`py-1.5 px-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  themePreference === 'dark'
                    ? 'bg-indigo-600 text-white shadow-sm font-semibold'
                    : 'text-slate-600 dark:text-white/60 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">dark_mode</span>
                <span>Dark</span>
              </button>
              <button
                type="button"
                onClick={() => onSelectTheme('system')}
                className={`py-1.5 px-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  themePreference === 'system'
                    ? 'bg-white dark:bg-white/20 text-slate-900 dark:text-white shadow-sm font-semibold'
                    : 'text-slate-600 dark:text-white/60 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">settings_brightness</span>
                <span>Auto</span>
              </button>
            </div>
          </div>

          {/* Action 6: Help & Architecture */}
          <button
            type="button"
            role="menuitem"
            onClick={() => handleItemClick('about')}
            className="w-full flex items-center justify-between p-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-white/10 active:scale-[0.98] transition-all group text-left cursor-pointer"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center transition-transform group-hover:scale-110 shrink-0">
                <span className="material-symbols-outlined text-[19px]">info</span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-white leading-tight truncate">
                  Help &amp; Architecture
                </p>
                <p className="text-[11px] text-slate-500 dark:text-white/40 leading-tight mt-0.5 truncate">
                  Manifesto, shortcuts &amp; telemetry
                </p>
              </div>
            </div>
            <span className="material-symbols-outlined text-slate-400 dark:text-white/30 group-hover:text-slate-900 dark:group-hover:text-white group-hover:translate-x-0.5 transition-all text-sm shrink-0">
              chevron_right
            </span>
          </button>

          {/* Divider */}
          <div className="h-px bg-slate-200 dark:bg-white/10 my-1" />

          {/* Action 5: Sign Out */}
          <button
            type="button"
            role="menuitem"
            onClick={() => handleItemClick('signout')}
            className="w-full flex items-center justify-between p-2.5 rounded-2xl hover:bg-rose-50 dark:hover:bg-rose-500/15 text-rose-600 dark:text-rose-400 active:scale-[0.98] transition-all group text-left cursor-pointer"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center transition-transform group-hover:scale-110 shrink-0">
                <span className="material-symbols-outlined text-[19px]">logout</span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-tight truncate">
                  Lock &amp; Sign Out
                </p>
                <p className="text-[11px] text-rose-500/80 dark:text-rose-400/70 leading-tight mt-0.5 truncate">
                  Secure local vault session
                </p>
              </div>
            </div>
            <span className="material-symbols-outlined text-rose-400/50 group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors text-sm shrink-0">
              lock
            </span>
          </button>
        </div>

        {/* Bottom subtle version & node stamp */}
        <div className="px-4 py-2 bg-slate-50 dark:bg-black/40 border-t border-slate-100 dark:border-white/5 text-[10px] font-mono text-slate-500 dark:text-white/40 flex items-center justify-between shrink-0">
          <span>Twin Vault Node: NY-042</span>
          <span>v4.2.1-frosted</span>
        </div>
      </div>
    </>,
    document.body
  );
};
