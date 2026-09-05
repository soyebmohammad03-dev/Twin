/**
 * Phase 35 — Twin Chat's account-scoped persistence. Extracted as
 * pure, dependency-free functions (no React, no fetch) specifically so
 * the account-isolation guarantee — the single most security-relevant
 * property of this module — can be unit-tested directly, the same way
 * graphMapper.ts/ingestionActivity.ts are, rather than only ever
 * exercised indirectly through App.tsx.
 *
 * Twin Chat's transcript can contain highly personal, evidence-grounded
 * content (see @twin/contracts' ChatEvidence). It must never survive an
 * account switch in the same browser: every signed-in user gets their
 * own storage key, keyed by their real user id — never a single shared
 * key — so User B can never restore User A's conversation merely by
 * signing in on the same device. Anonymous/pre-auth state (userId
 * undefined, e.g. before session restoration resolves) never reads or
 * writes anything.
 */

import type { ChatMessage } from '../types';

const LEGACY_UNSCOPED_KEY = 'twin_chat';

export function chatStorageKey(userId: string): string {
  return `twin_chat_${userId}`;
}

/**
 * Safe read: no signed-in user, no stored value, or malformed/corrupt
 * JSON all yield an honest empty conversation — never a partial or
 * garbled restore, and never another user's data (each user only ever
 * reads their own key).
 */
export function loadStoredChatMessages(userId: string | undefined): ChatMessage[] {
  if (!userId) return [];
  try {
    const saved = localStorage.getItem(chatStorageKey(userId));
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Never persists anonymous/pre-auth state — a caller with no signed-in user must not call this at all; enforced here too as a safety net. */
export function persistChatMessages(userId: string | undefined, messages: ChatMessage[]): void {
  if (!userId) return;
  const persistable = messages.filter((m) => !m.pending);
  localStorage.setItem(chatStorageKey(userId), JSON.stringify(persistable));
}

export function clearChatMessages(userId: string | undefined): void {
  if (!userId) return;
  localStorage.removeItem(chatStorageKey(userId));
}

/**
 * One-time purge of the pre-Phase-35 unscoped key — no code path reads
 * it any more, but leaving old conversation content sitting under a
 * shared key indefinitely is unnecessary risk for no benefit. Safe to
 * call unconditionally and repeatedly (e.g. once per app load).
 */
export function purgeLegacyUnscopedChatStorage(): void {
  try {
    localStorage.removeItem(LEGACY_UNSCOPED_KEY);
  } catch {
    // Storage access can throw in some private-browsing modes — a
    // legacy-key cleanup failing silently is fine; nothing reads it.
  }
}
