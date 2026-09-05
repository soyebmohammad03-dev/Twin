import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  ThemePreference,
  ThemeMode,
  AccentColor,
  FrostedIntensity,
  AccountSection,
  UserPreferences,
} from '../types';
import { INITIAL_USER } from '../data/mockData';
import { authService, User, SignUpInput, SignInInput } from '../services/authService';
import { generateInitialsAvatar } from '../services/avatar';

export interface UserProfileData {
  id?: string;
  name: string;
  displayName: string;
  handle: string;
  email: string;
  role: string;
  location: string;
  bio: string;
  avatarUrl?: string;
  lightAvatarUrl?: string;
}

interface AppContextType {
  // Authentication & Session
  isAuthenticated: boolean;
  isAuthChecking: boolean;
  currentUser: User | null;
  isVaultLocked: boolean;
  isSplashActive: boolean;
  dismissSplash: () => void;
  signIn: (input: SignInInput) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<void>;
  signOut: () => Promise<void>;
  lockVault: () => void;
  unlockVault: () => void;

  // Theme & Appearance
  themePreference: ThemePreference;
  resolvedTheme: ThemeMode;
  setThemePreference: (pref: ThemePreference) => void;
  accentColor: AccentColor;
  setAccentColor: (color: AccentColor) => void;
  frostedIntensity: FrostedIntensity;
  setFrostedIntensity: (intensity: FrostedIntensity) => void;

  // Preferences (Settings, Notifications, Privacy)
  preferences: UserPreferences;
  updatePreferences: (partial: Partial<UserPreferences>) => void;

  // User Identity Profile
  userProfile: UserProfileData;
  updateUserProfile: (partial: Partial<UserProfileData>) => void;

  // Account Center Navigation
  activeAccountSection: AccountSection | null;
  openAccountSection: (section: AccountSection) => void;
  closeAccountModal: () => void;
}

const DEFAULT_PREFERENCES: UserPreferences = {
  assistantTone: 'warm',
  proactivityLevel: 'balanced',
  autoSynthesis: true,
  soundEffects: false,
  masterNotifications: true,
  morningBriefing: true,
  eveningRecap: true,
  patternAlerts: true,
  insightUpdates: true,
  memoryReminders: true,
  dailySummary: true,
  biometricLock: true,
  autoLockMinutes: '15',
  incognitoMode: false,
  micAccess: true,
  retentionPeriod: 'forever',
};

const DEFAULT_PROFILE: UserProfileData = {
  name: INITIAL_USER.name,
  displayName: INITIAL_USER.displayName,
  handle: INITIAL_USER.handle,
  email: INITIAL_USER.email,
  role: INITIAL_USER.role,
  location: INITIAL_USER.location,
  bio: 'Exploring high-velocity creative cognition and ambient computing interfaces.',
};

const AppContext = createContext<AppContextType | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 1. Splash Screen
  const [isSplashActive, setIsSplashActive] = useState<boolean>(true);

  // 2. Authentication State (backed by the real Twin API — see services/authService.ts)
  // There is no synchronous "current user" any more: the only signal of
  // an existing session is the httpOnly refresh-token cookie, which can
  // only be checked by asking the API. isAuthChecking covers that gap
  // so the UI can hold a loading state instead of flashing sign-in.
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(true);

  const [isVaultLocked, setIsVaultLocked] = useState<boolean>(false);

  // 3. Theme & Appearance
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() => {
    try {
      const stored = localStorage.getItem('twin_theme_pref') as ThemePreference | null;
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored;
      }
    } catch {}
    return 'dark';
  });

  const [accentColor, setAccentColorState] = useState<AccentColor>(() => {
    try {
      const stored = localStorage.getItem('twin_accent_color') as AccentColor | null;
      if (stored && ['indigo', 'violet', 'emerald', 'amber'].includes(stored)) {
        return stored;
      }
    } catch {}
    return 'indigo';
  });

  const [frostedIntensity, setFrostedIntensityState] = useState<FrostedIntensity>(() => {
    try {
      const stored = localStorage.getItem('twin_frosted_intensity') as FrostedIntensity | null;
      if (stored && ['subtle', 'balanced', 'deep'].includes(stored)) {
        return stored;
      }
    } catch {}
    return 'balanced';
  });

  // Calculate resolved theme
  const getSystemTheme = (): ThemeMode => {
    if (typeof window === 'undefined') return 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };

  const [resolvedTheme, setResolvedTheme] = useState<ThemeMode>(() => {
    if (themePreference === 'system') return getSystemTheme();
    return themePreference;
  });

  // 4. Preferences (Settings, Notifications, Privacy)
  const [preferences, setPreferences] = useState<UserPreferences>(() => {
    try {
      const stored = localStorage.getItem('twin_user_preferences');
      if (stored) {
        return { ...DEFAULT_PREFERENCES, ...JSON.parse(stored) };
      }
    } catch {}
    return DEFAULT_PREFERENCES;
  });

  // 5. User Profile. Identity fields (name/email/handle/id/avatar) are
  // authoritative from the API and only known once session restoration
  // resolves (see the effect below). Non-identity fields (role,
  // location, bio) are a separate, unrelated feature that already
  // persists via localStorage — untouched by the auth integration.
  const [userProfile, setUserProfile] = useState<UserProfileData>(() => {
    try {
      const stored = localStorage.getItem('twin_profile_user');
      if (stored) {
        return { ...DEFAULT_PROFILE, ...JSON.parse(stored) };
      }
    } catch {}
    return DEFAULT_PROFILE;
  });

  // 6. Account Center Modal Navigation State
  const [activeAccountSection, setActiveAccountSection] = useState<AccountSection | null>(null);

  // Sync theme changes to DOM and local storage
  const setThemePreference = useCallback((pref: ThemePreference) => {
    setThemePreferenceState(pref);
    try {
      localStorage.setItem('twin_theme_pref', pref);
    } catch {}
  }, []);

  const setAccentColor = useCallback((color: AccentColor) => {
    setAccentColorState(color);
    try {
      localStorage.setItem('twin_accent_color', color);
    } catch {}
  }, []);

  const setFrostedIntensity = useCallback((intensity: FrostedIntensity) => {
    setFrostedIntensityState(intensity);
    try {
      localStorage.setItem('twin_frosted_intensity', intensity);
    } catch {}
  }, []);

  // Update DOM attributes on theme/accent/intensity changes
  useEffect(() => {
    const computedTheme: ThemeMode =
      themePreference === 'system' ? getSystemTheme() : themePreference;
    setResolvedTheme(computedTheme);

    const root = document.documentElement;
    if (computedTheme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }

    root.setAttribute('data-accent', accentColor);
    root.setAttribute('data-glass', frostedIntensity);

    // Listen for system theme changes if in 'system' mode
    if (themePreference === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = (e: MediaQueryListEvent) => {
        const newTheme = e.matches ? 'dark' : 'light';
        setResolvedTheme(newTheme);
        if (newTheme === 'dark') {
          root.classList.add('dark');
          root.classList.remove('light');
        } else {
          root.classList.add('light');
          root.classList.remove('dark');
        }
      };
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [themePreference, accentColor, frostedIntensity]);

  // Dismiss splash screen helper
  const dismissSplash = useCallback(() => {
    setIsSplashActive(false);
  }, []);

  // Authentication Handlers
  // Applies a real API user onto local identity state. Non-identity
  // profile fields (role/location/bio) are intentionally untouched
  // here — the API doesn't have them yet, so existing customizations
  // (persisted separately via updateUserProfile) are preserved rather
  // than overwritten with defaults on every sign-in.
  const applyAuthenticatedUser = useCallback((user: User) => {
    setCurrentUser(user);
    setUserProfile((prev) => ({
      ...prev,
      id: user.id,
      name: user.fullName,
      displayName: user.displayName,
      handle: `@${user.handle}`,
      email: user.email,
      avatarUrl: generateInitialsAvatar(user.fullName, false),
      lightAvatarUrl: generateInitialsAvatar(user.fullName, true),
    }));
    setIsAuthenticated(true);
    setIsVaultLocked(false);
  }, []);

  const signIn = useCallback(
    async (input: SignInInput): Promise<void> => {
      const result = await authService.signIn(input);
      applyAuthenticatedUser(result.user);
    },
    [applyAuthenticatedUser],
  );

  const signUp = useCallback(
    async (input: SignUpInput): Promise<void> => {
      const result = await authService.signUp(input);
      applyAuthenticatedUser(result.user);
    },
    [applyAuthenticatedUser],
  );

  const signOut = useCallback(async (): Promise<void> => {
    await authService.signOut();
    setCurrentUser(null);
    setIsAuthenticated(false);
    setIsVaultLocked(false);
    setActiveAccountSection(null);
    // Reset profile customizations (role/location/bio) rather than
    // leaving them in state/localStorage — otherwise a different
    // account signing in on this device would inherit the previous
    // user's profile details.
    setUserProfile(DEFAULT_PROFILE);
    try {
      localStorage.removeItem('twin_profile_user');
    } catch {}
  }, []);

  // Session restoration on app start. The only signal of an existing
  // session is the httpOnly refresh-token cookie, so this can only be
  // resolved by asking the API — never assumes success, and never
  // falls back to a hardcoded demo user.
  useEffect(() => {
    let cancelled = false;

    authService.restoreSession().then((result) => {
      if (cancelled) return;
      if (result) {
        applyAuthenticatedUser(result.user);
      }
      setIsAuthChecking(false);
    });

    return () => {
      cancelled = true;
    };
  }, [applyAuthenticatedUser]);

  const lockVault = useCallback(() => {
    setIsVaultLocked(true);
  }, []);

  const unlockVault = useCallback(() => {
    setIsVaultLocked(false);
  }, []);

  // Update Preferences Handler
  const updatePreferences = useCallback((partial: Partial<UserPreferences>) => {
    setPreferences((prev) => {
      const updated = { ...prev, ...partial };
      try {
        localStorage.setItem('twin_user_preferences', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  // Update Profile Handler
  const updateUserProfile = useCallback((partial: Partial<UserProfileData>) => {
    setUserProfile((prev) => {
      const updated = { ...prev, ...partial };
      try {
        localStorage.setItem('twin_profile_user', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  // Account Modal Navigation Handlers
  const openAccountSection = useCallback((section: AccountSection) => {
    setActiveAccountSection(section);
  }, []);

  const closeAccountModal = useCallback(() => {
    setActiveAccountSection(null);
  }, []);

  return (
    <AppContext.Provider
      value={{
        isAuthenticated,
        isAuthChecking,
        currentUser,
        isVaultLocked,
        isSplashActive,
        dismissSplash,
        signIn,
        signUp,
        signOut,
        lockVault,
        unlockVault,
        themePreference,
        resolvedTheme,
        setThemePreference,
        accentColor,
        setAccentColor,
        frostedIntensity,
        setFrostedIntensity,
        preferences,
        updatePreferences,
        userProfile,
        updateUserProfile,
        activeAccountSection,
        openAccountSection,
        closeAccountModal,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = (): AppContextType => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
