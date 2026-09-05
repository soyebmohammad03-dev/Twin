import { eq } from 'drizzle-orm';
import { users, sessions, type Database } from '@twin/db';
import { hashPassword, verifyPassword } from './password.js';
import { generateRefreshToken, hashRefreshToken, REFRESH_TOKEN_TTL_MS } from './tokens.js';

export class AuthError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export type UserRow = typeof users.$inferSelect;

interface SessionMeta {
  userAgent?: string;
  ipAddress?: string;
}

function deriveHandle(fullName: string): string {
  const base = fullName.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'user';
  return `${base}${Math.floor(1000 + Math.random() * 9000)}`;
}

/**
 * Real, server-backed auth — but explicitly not production-complete.
 * Missing on purpose for Phase 1: email verification, password reset,
 * MFA, rate limiting / lockout, and refresh-token reuse detection.
 * See docs/architecture.md for the full list.
 */
export function createAuthService(db: Database) {
  async function signUp(input: { fullName: string; email: string; password: string; handle?: string }): Promise<UserRow> {
    const email = input.email.trim().toLowerCase();
    const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (existing) {
      throw new AuthError('An account with this email already exists.', 409);
    }

    const passwordHash = await hashPassword(input.password);
    const fullName = input.fullName.trim();

    const [user] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        fullName,
        displayName: fullName.split(' ')[0] || fullName,
        handle: input.handle?.trim() ?? deriveHandle(fullName),
      })
      .returning();

    if (!user) {
      throw new Error('User insert returned no row.');
    }
    return user;
  }

  async function verifyCredentials(email: string, password: string): Promise<UserRow> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await db.query.users.findFirst({ where: eq(users.email, normalizedEmail) });
    if (!user) {
      throw new AuthError('Invalid email or password.', 401);
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      throw new AuthError('Invalid email or password.', 401);
    }

    return user;
  }

  async function createSession(userId: string, meta: SessionMeta) {
    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    await db.insert(sessions).values({
      userId,
      refreshTokenHash,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
      expiresAt,
    });

    return { refreshToken, expiresAt };
  }

  async function rotateSession(presentedRefreshToken: string, meta: SessionMeta) {
    const presentedHash = hashRefreshToken(presentedRefreshToken);
    const session = await db.query.sessions.findFirst({
      where: eq(sessions.refreshTokenHash, presentedHash),
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new AuthError('Refresh token is invalid or expired.', 401);
    }

    // Rotate: revoke the presented token and issue a new one. Limits
    // how long a stolen refresh token remains useful.
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, session.id));

    const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
    if (!user) {
      throw new AuthError('User no longer exists.', 401);
    }

    const next = await createSession(session.userId, meta);
    return { user, ...next };
  }

  async function revokeSession(presentedRefreshToken: string): Promise<void> {
    const presentedHash = hashRefreshToken(presentedRefreshToken);
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.refreshTokenHash, presentedHash));
  }

  async function getUserById(id: string): Promise<UserRow | undefined> {
    return db.query.users.findFirst({ where: eq(users.id, id) });
  }

  return { signUp, verifyCredentials, createSession, rotateSession, revokeSession, getUserById };
}

export type AuthService = ReturnType<typeof createAuthService>;
