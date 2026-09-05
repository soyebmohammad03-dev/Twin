import { randomBytes, createHash } from 'node:crypto';

export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes

export function generateRefreshToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Refresh tokens are stored only as a SHA-256 hash — a database leak
 * alone can't be replayed as a valid session.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
