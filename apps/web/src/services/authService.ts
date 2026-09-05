/**
 * Twin Authentication Service (real backend)
 *
 * Talks to the Twin API's /auth/* endpoints (apps/api/src/modules/auth,
 * contract shapes in packages/contracts/src/auth.ts). This replaces the
 * previous prototype implementation, which stored users and a fake
 * password hash directly in localStorage.
 *
 * Session model for the web client, matching the API's design
 * (docs/architecture.md):
 * - The refresh token lives ONLY in the httpOnly cookie the API sets.
 *   It never touches JS-accessible storage here — fetch calls use
 *   `credentials: 'include'` so the browser attaches/receives it
 *   automatically.
 * - The short-lived access token and current user are held in memory
 *   only (in AppContext's React state), not persisted. On page load,
 *   `restoreSession()` uses the cookie to silently re-establish both.
 *
 * This is a first real integration, not a hardened production auth
 * client: there is no proactive access-token refresh timer (nothing
 * else in the app calls a protected endpoint yet to need one), no
 * retry/backoff, and no CSRF token beyond SameSite=Lax cookie scoping.
 */

import type {
  AuthSessionResponse,
  ErrorResponse,
  SignInRequest,
  SignUpRequest,
  UserDto,
} from '@twin/contracts';

export const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export type User = UserDto;

export interface SignUpInput {
  fullName: string;
  email: string;
  password: string;
  handle?: string;
}

export interface SignInInput {
  email: string;
  password: string;
}

export interface AuthResult {
  user: User;
  accessToken: string;
  accessTokenExpiresAt: string;
}

/** Thrown for any failed auth API call, carrying the API's own message. */
export class AuthApiError extends Error {}

function stripHandlePrefix(handle: string | undefined): string | undefined {
  const trimmed = handle?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^@+/, '') || undefined;
}

async function parseSessionOrThrow(response: Response): Promise<AuthSessionResponse> {
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // No JSON body (e.g. network-level failure surfaced as a response) — fall through to generic error below.
  }

  if (!response.ok) {
    const message = (data as ErrorResponse | null)?.message;
    throw new AuthApiError(message || 'Something went wrong. Please try again.');
  }

  return data as AuthSessionResponse;
}

function toAuthResult(session: AuthSessionResponse): AuthResult {
  return {
    user: session.user,
    accessToken: session.accessToken,
    accessTokenExpiresAt: session.accessTokenExpiresAt,
  };
}

// The current access token, held in memory only — never persisted.
// Other API clients (memoryApi.ts) read it via getAccessToken() rather
// than each tracking their own copy of the session.
let currentAccessToken: string | null = null;

class AuthService {
  getAccessToken(): string | null {
    return currentAccessToken;
  }

  async signUp(input: SignUpInput): Promise<AuthResult> {
    const body: SignUpRequest = {
      fullName: input.fullName.trim(),
      email: input.email.trim().toLowerCase(),
      password: input.password,
      handle: stripHandlePrefix(input.handle),
    };

    const response = await fetch(`${API_BASE_URL}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });

    const result = toAuthResult(await parseSessionOrThrow(response));
    currentAccessToken = result.accessToken;
    return result;
  }

  async signIn(input: SignInInput): Promise<AuthResult> {
    const body: SignInRequest = {
      email: input.email.trim().toLowerCase(),
      password: input.password,
    };

    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });

    const result = toAuthResult(await parseSessionOrThrow(response));
    currentAccessToken = result.accessToken;
    return result;
  }

  /**
   * Attempts to restore a session from the httpOnly refresh-token
   * cookie. Returns null when there is no valid session — a fresh
   * browser or an expired/absent cookie — which is an expected
   * outcome, not an error condition.
   */
  async restoreSession(): Promise<AuthResult | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        return null;
      }

      const result = toAuthResult(await parseSessionOrThrow(response));
      currentAccessToken = result.accessToken;
      return result;
    } catch {
      // API unreachable or a network error — treat as "no session"
      // rather than failing app startup.
      return null;
    }
  }

  async signOut(): Promise<void> {
    currentAccessToken = null;
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
    } catch {
      // Best-effort — the caller clears local session state regardless
      // of whether the server-side revoke succeeded.
    }
  }
}

export const authService = new AuthService();
