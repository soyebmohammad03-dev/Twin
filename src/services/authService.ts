/**
 * Twin Authentication Service (Prototype Layer)
 *
 * This abstraction provides a clean, decoupled authentication interface.
 * UI components interact strictly through this interface or AppContext,
 * allowing this prototype (which uses localStorage for persistence) to be
 * seamlessly replaced by a production backend API (e.g. Node/Express, MongoDB,
 * JWT/session cookies, bcrypt password hashing) in subsequent phases without
 * refactoring UI components.
 */

import { INITIAL_USER } from '../data/mockData';

export interface User {
  id: string;
  fullName: string;
  displayName: string;
  email: string;
  handle: string;
  createdAt: string;
  avatarUrl?: string;
  lightAvatarUrl?: string;
  role?: string;
  location?: string;
  bio?: string;
}

export interface StoredUserRecord extends User {
  /**
   * Encrypted/hashed passcode in prototype storage.
   * NEVER exposed in session state or user profile.
   */
  passwordHash: string;
}

export interface SignUpInput {
  fullName: string;
  email: string;
  password: string;
  handle?: string;
}

export interface SignInInput {
  emailOrHandle: string;
  password: string;
}

export interface AuthSession {
  user: User;
  token: string;
  authenticatedAt: string;
  expiresAt: number;
}

export interface IAuthService {
  signUp(input: SignUpInput): Promise<User>;
  signIn(input: SignInInput): Promise<User>;
  signInDemo(): Promise<User>;
  signOut(): Promise<void>;
  getCurrentUser(): User | null;
  isAuthenticated(): boolean;
  getStoredUsers(): User[];
}

const STORAGE_KEYS = {
  SESSION: 'twin_auth_session',
  USERS: 'twin_auth_users',
  AUTH_FLAG: 'twin_auth_state',
};

// Seed Alex Rivera demo account as initial registered user
const DEMO_USER_ID = 'usr-alex-rivera';
const DEMO_USER: StoredUserRecord = {
  id: DEMO_USER_ID,
  fullName: INITIAL_USER.name,
  displayName: INITIAL_USER.displayName,
  handle: INITIAL_USER.handle,
  email: INITIAL_USER.email,
  role: INITIAL_USER.role,
  location: INITIAL_USER.location,
  bio: 'Exploring high-velocity creative cognition and ambient computing interfaces.',
  createdAt: '2023-11-15T00:00:00.000Z',
  avatarUrl: INITIAL_USER.avatarUrl,
  lightAvatarUrl: INITIAL_USER.lightAvatarUrl,
  passwordHash: 'twin-demo-passcode', // Default demo key
};

// Simple reversible obfuscation for prototype local storage (NOT for production)
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `h_${Math.abs(hash).toString(16)}_${str.length}`;
}

// Generate an SVG data-URI avatar based on user initials and palette
export function generateInitialsAvatar(name: string, isLight: boolean = false): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

  const bgGradient = isLight
    ? 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)'
    : 'linear-gradient(135deg, #4338ca 0%, #7e22ce 100%)';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${isLight ? '#6366f1' : '#4338ca'}"/>
        <stop offset="100%" stop-color="${isLight ? '#a855f7' : '#7e22ce'}"/>
      </linearGradient>
    </defs>
    <circle cx="64" cy="64" r="64" fill="url(#grad)"/>
    <text x="50%" y="54%" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="44" font-weight="700" fill="#ffffff" dominant-baseline="middle" text-anchor="middle" letter-spacing="1">
      ${initials || 'TW'}
    </text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

class PrototypeAuthService implements IAuthService {
  private memorySession: AuthSession | null = null;

  constructor() {
    this.ensureInitialized();
  }

  private ensureInitialized() {
    try {
      const existing = localStorage.getItem(STORAGE_KEYS.USERS);
      if (!existing) {
        localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify([DEMO_USER]));
      } else {
        // Ensure demo user is always present
        const parsed: StoredUserRecord[] = JSON.parse(existing);
        if (!parsed.some((u) => u.email.toLowerCase() === DEMO_USER.email.toLowerCase())) {
          parsed.unshift(DEMO_USER);
          localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(parsed));
        }
      }
    } catch (e) {
      console.warn('LocalStorage unavailable in prototype auth service:', e);
    }
  }

  private getStoredUserRecords(): StoredUserRecord[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.USERS);
      if (!raw) return [DEMO_USER];
      return JSON.parse(raw);
    } catch {
      return [DEMO_USER];
    }
  }

  private saveStoredUserRecords(users: StoredUserRecord[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
    } catch (e) {
      console.error('Failed to persist prototype users:', e);
    }
  }

  private saveSession(user: User): void {
    const session: AuthSession = {
      user,
      token: `twin_token_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      authenticatedAt: new Date().toISOString(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
    };
    this.memorySession = session;

    try {
      localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
      localStorage.setItem(STORAGE_KEYS.AUTH_FLAG, 'true');
      // Also update active profile cache for fast synchronous initial render
      localStorage.setItem(
        'twin_profile_user',
        JSON.stringify({
          name: user.fullName,
          displayName: user.displayName,
          handle: user.handle,
          email: user.email,
          role: user.role || 'Twin Architect',
          location: user.location || 'Local Vault',
          bio: user.bio || '',
          avatarUrl: user.avatarUrl,
          lightAvatarUrl: user.lightAvatarUrl,
        })
      );
    } catch (e) {
      console.warn('Session persistence warning:', e);
    }
  }

  private clearSession(): void {
    this.memorySession = null;
    try {
      localStorage.removeItem(STORAGE_KEYS.SESSION);
      localStorage.setItem(STORAGE_KEYS.AUTH_FLAG, 'false');
    } catch (e) {
      console.warn('Clear session warning:', e);
    }
  }

  /**
   * Authenticate with existing credentials.
   * Supports email or handle.
   */
  async signIn({ emailOrHandle, password }: SignInInput): Promise<User> {
    const normalizedIdentifier = emailOrHandle.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (!normalizedIdentifier) {
      throw new Error('Please enter your account email or handle.');
    }
    if (!cleanPassword) {
      throw new Error('Please enter your vault passcode.');
    }

    const users = this.getStoredUserRecords();
    const matchedRecord = users.find(
      (u) =>
        u.email.toLowerCase() === normalizedIdentifier ||
        u.handle.toLowerCase() === normalizedIdentifier ||
        u.handle.toLowerCase() === `@${normalizedIdentifier.replace(/^@/, '')}`
    );

    if (!matchedRecord) {
      throw new Error('No Twin vault account found with this email or handle.');
    }

    // Check passcode against prototype record
    // For demo account, allow demo password or any key if in quick demo mode
    const isDemo = matchedRecord.id === DEMO_USER_ID;
    const isMatch =
      matchedRecord.passwordHash === simpleHash(cleanPassword) ||
      (isDemo && (cleanPassword === 'twin-demo-passcode' || cleanPassword === '••••••••••••' || cleanPassword.length >= 4));

    if (!isMatch) {
      throw new Error('Incorrect vault passcode. Please check your credentials.');
    }

    // Strip passwordHash before creating session
    const { passwordHash: _, ...safeUser } = matchedRecord;
    this.saveSession(safeUser);
    return safeUser;
  }

  /**
   * Register a new prototype user account.
   * Authenticates automatically upon successful registration.
   */
  async signUp(input: SignUpInput): Promise<User> {
    const trimmedName = input.fullName.trim();
    const trimmedEmail = input.email.trim().toLowerCase();
    const trimmedPassword = input.password.trim();

    // Validation
    if (!trimmedName) {
      throw new Error('Please provide your full name.');
    }
    if (!trimmedEmail) {
      throw new Error('Please provide an email address.');
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      throw new Error('Please enter a valid email address (e.g. name@domain.com).');
    }
    if (!trimmedPassword) {
      throw new Error('Please create a vault passcode.');
    }
    if (trimmedPassword.length < 6) {
      throw new Error('Vault passcode must be at least 6 characters.');
    }

    const users = this.getStoredUserRecords();

    // Prevent duplicate email registration
    const existing = users.find((u) => u.email.toLowerCase() === trimmedEmail);
    if (existing) {
      throw new Error('An account with this email already exists. Please sign in instead.');
    }

    // Auto-generate clean handle if not supplied
    let cleanHandle = input.handle?.trim();
    if (!cleanHandle) {
      const sanitizedName = trimmedName.toLowerCase().replace(/[^a-z0-9]/g, '');
      cleanHandle = `@${sanitizedName || 'user'}${Math.floor(100 + Math.random() * 900)}`;
    } else if (!cleanHandle.startsWith('@')) {
      cleanHandle = `@${cleanHandle}`;
    }

    const initials = trimmedName.split(' ')[0] || trimmedName;
    const darkAvatar = generateInitialsAvatar(trimmedName, false);
    const lightAvatar = generateInitialsAvatar(trimmedName, true);

    const newRecord: StoredUserRecord = {
      id: `usr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      fullName: trimmedName,
      displayName: initials,
      email: trimmedEmail,
      handle: cleanHandle,
      role: 'Twin Intelligence Architect',
      location: 'Local Encrypted Node',
      bio: 'Personal cognition space and encrypted knowledge vault.',
      createdAt: new Date().toISOString(),
      avatarUrl: darkAvatar,
      lightAvatarUrl: lightAvatar,
      passwordHash: simpleHash(trimmedPassword),
    };

    // Save into stored accounts
    users.unshift(newRecord);
    this.saveStoredUserRecords(users);

    // Automatically establish authenticated session
    const { passwordHash: _, ...safeUser } = newRecord;
    this.saveSession(safeUser);
    return safeUser;
  }

  /**
   * One-click demo login (Alex Rivera PRO account)
   */
  async signInDemo(): Promise<User> {
    const { passwordHash: _, ...safeUser } = DEMO_USER;
    this.saveSession(safeUser);
    return safeUser;
  }

  /**
   * Sign out current user
   */
  async signOut(): Promise<void> {
    this.clearSession();
  }

  /**
   * Retrieve current authenticated user, checking memory cache or stored session
   */
  getCurrentUser(): User | null {
    if (this.memorySession && this.memorySession.expiresAt > Date.now()) {
      return this.memorySession.user;
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SESSION);
      if (!raw) return null;
      const parsed: AuthSession = JSON.parse(raw);
      if (parsed && parsed.expiresAt > Date.now()) {
        this.memorySession = parsed;
        return parsed.user;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Check if current session is authenticated
   */
  isAuthenticated(): boolean {
    const user = this.getCurrentUser();
    if (!user) return false;
    try {
      const flag = localStorage.getItem(STORAGE_KEYS.AUTH_FLAG);
      return flag === 'true';
    } catch {
      return true;
    }
  }

  /**
   * Retrieve list of registered accounts in prototype
   */
  getStoredUsers(): User[] {
    return this.getStoredUserRecords().map(({ passwordHash: _, ...safeUser }) => safeUser);
  }
}

// Export singleton instance for app-wide use
export const authService: IAuthService = new PrototypeAuthService();
