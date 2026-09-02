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
import { authService, User, SignUpInput } from '../services/authService';

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
  currentUser: User | null;
  isVaultLocked: boolean;
  isSplashActive: boolean;
  dismissSplash: () => void;
  signIn: (emailOrHandle: string, password?: string) => Promise<boolean>;
  signUp: (input: SignUpInput) => Promise<boolean>;
  signInDemo: () => Promise<boolean>;
  signOut: () => void;
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

  // 2. Authentication State (managed via decoupled AuthService)
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    return authService.getCurrentUser();
  });

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return authService.isAuthenticated();
  });

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

  // 5. User Profile (Synchronized with authenticated user)
  const [userProfile, setUserProfile] = useState<UserProfileData>(() => {
    const activeUser = authService.getCurrentUser();
    if (activeUser) {
      return {
        id: activeUser.id,
        name: activeUser.fullName,
        displayName: activeUser.displayName,
        handle: activeUser.handle,
        email: activeUser.email,
        role: activeUser.role || 'Twin Intelligence Architect',
        location: activeUser.location || 'Local Encrypted Node',
        bio: activeUser.bio || 'Exploring high-velocity creative cognition and ambient computing interfaces.',
        avatarUrl: activeUser.avatarUrl,
        lightAvatarUrl: activeUser.lightAvatarUrl,
      };
    }
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
  const signIn = useCallback(async (emailOrHandle: string, password?: string): Promise<boolean> => {
    const user = await authService.signIn({
      emailOrHandle,
      password: password || 'twin-demo-passcode',
    });
    setCurrentUser(user);
    setUserProfile({
      id: user.id,
      name: user.fullName,
      displayName: user.displayName,
      handle: user.handle,
      email: user.email,
      role: user.role || 'Twin Intelligence Architect',
      location: user.location || 'Local Encrypted Node',
      bio: user.bio || 'Exploring high-velocity creative cognition and ambient computing interfaces.',
      avatarUrl: user.avatarUrl,
      lightAvatarUrl: user.lightAvatarUrl,
    });
    setIsAuthenticated(true);
    setIsVaultLocked(false);
    return true;
  }, []);

  const signUp = useCallback(async (input: SignUpInput): Promise<boolean> => {
    const user = await authService.signUp(input);
    setCurrentUser(user);
    setUserProfile({
      id: user.id,
      name: user.fullName,
      displayName: user.displayName,
      handle: user.handle,
      email: user.email,
      role: user.role || 'Twin Intelligence Architect',
      location: user.location || 'Local Encrypted Node',
      bio: user.bio || 'Exploring high-velocity creative cognition and ambient computing interfaces.',
      avatarUrl: user.avatarUrl,
      lightAvatarUrl: user.lightAvatarUrl,
    });
    setIsAuthenticated(true);
    setIsVaultLocked(false);
    return true;
  }, []);

  const signInDemo = useCallback(async (): Promise<boolean> => {
    const user = await authService.signInDemo();
    setCurrentUser(user);
    setUserProfile({
      id: user.id,
      name: user.fullName,
      displayName: user.displayName,
      handle: user.handle,
      email: user.email,
      role: user.role || INITIAL_USER.role,
      location: user.location || INITIAL_USER.location,
      bio: user.bio || 'Exploring high-velocity creative cognition and ambient computing interfaces.',
      avatarUrl: user.avatarUrl,
      lightAvatarUrl: user.lightAvatarUrl,
    });
    setIsAuthenticated(true);
    setIsVaultLocked(false);
    return true;
  }, []);

  const signOut = useCallback(() => {
    authService.signOut();
    setCurrentUser(null);
    setIsAuthenticated(false);
    setIsVaultLocked(false);
    setActiveAccountSection(null);
  }, []);

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
        currentUser,
        isVaultLocked,
        isSplashActive,
        dismissSplash,
        signIn,
        signUp,
        signInDemo,
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
