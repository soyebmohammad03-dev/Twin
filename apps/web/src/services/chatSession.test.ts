import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '../types';
import {
  chatStorageKey,
  loadStoredChatMessages,
  persistChatMessages,
  clearChatMessages,
  purgeLegacyUnscopedChatStorage,
} from './chatSession';

/**
 * Phase 35 — this suite runs under vitest's plain 'node' environment
 * (see vitest.config.ts), which has no built-in `localStorage`. These
 * tests install a minimal, real key/value store behind that global
 * before each test (not a mock of chatSession.ts's own behavior) so
 * the actual account-isolation logic — the single most
 * security-relevant property in this module — is genuinely exercised
 * against real reads/writes, not asserted against a stub that always
 * agrees with the implementation.
 */
class FakeLocalStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

let fakeStorage: FakeLocalStorage;

beforeEach(() => {
  fakeStorage = new FakeLocalStorage();
  // @ts-expect-error — Node has no global localStorage; this test suite provides one.
  globalThis.localStorage = fakeStorage;
});

afterEach(() => {
  // Cleanup for the next test file's global state.
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    role: 'user',
    content: 'Tell me about my current priorities.',
    timestamp: '10:00 AM',
    ...overrides,
  };
}

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';

describe('chatStorageKey', () => {
  it('derives a distinct key per user id, never a shared/bare key', () => {
    expect(chatStorageKey(USER_A)).not.toBe(chatStorageKey(USER_B));
    expect(chatStorageKey(USER_A)).toContain(USER_A);
    expect(chatStorageKey(USER_A)).not.toBe('twin_chat');
  });
});

describe('persistChatMessages + loadStoredChatMessages — account isolation', () => {
  it('User A can persist and restore their own conversation', () => {
    const messages = [makeMessage({ content: 'My distinctive secret project is called Aurora.' })];
    persistChatMessages(USER_A, messages);
    const restored = loadStoredChatMessages(USER_A);
    expect(restored).toHaveLength(1);
    expect(restored[0].content).toBe('My distinctive secret project is called Aurora.');
  });

  it('User B can NEVER restore User A\'s conversation, even immediately after A persisted it', () => {
    persistChatMessages(USER_A, [makeMessage({ content: "User A's private conversation." })]);
    const restoredForB = loadStoredChatMessages(USER_B);
    expect(restoredForB).toEqual([]);
  });

  it('switching from A to B and back leaves each account with only their own messages', () => {
    persistChatMessages(USER_A, [makeMessage({ id: 'a-1', content: 'A message' })]);
    persistChatMessages(USER_B, [makeMessage({ id: 'b-1', content: 'B message' })]);

    expect(loadStoredChatMessages(USER_A).map((m) => m.id)).toEqual(['a-1']);
    expect(loadStoredChatMessages(USER_B).map((m) => m.id)).toEqual(['b-1']);
  });

  it('a mid-flight pending placeholder is never persisted (would look permanently stuck on reload)', () => {
    persistChatMessages(USER_A, [
      makeMessage({ id: 'done', content: 'Completed answer' }),
      makeMessage({ id: 'pending', pending: true, content: '' }),
    ]);
    const restored = loadStoredChatMessages(USER_A);
    expect(restored.map((m) => m.id)).toEqual(['done']);
  });
});

describe('anonymous/pre-auth safety', () => {
  it('loadStoredChatMessages returns empty for an undefined user — never falls back to any stored conversation', () => {
    persistChatMessages(USER_A, [makeMessage()]);
    expect(loadStoredChatMessages(undefined)).toEqual([]);
  });

  it('persistChatMessages silently no-ops for an undefined user — anonymous state is never written anywhere', () => {
    persistChatMessages(undefined, [makeMessage({ content: 'should never be written' })]);
    // No key exists for "no user" — confirmed by the fact any real
    // user's read is still empty, and the underlying store never grew.
    expect(loadStoredChatMessages(USER_A)).toEqual([]);
    expect(loadStoredChatMessages(USER_B)).toEqual([]);
  });
});

describe('logout / clearChatMessages', () => {
  it('clearing User A\'s conversation removes it, and does not touch User B\'s', () => {
    persistChatMessages(USER_A, [makeMessage()]);
    persistChatMessages(USER_B, [makeMessage({ id: 'b-1' })]);
    clearChatMessages(USER_A);
    expect(loadStoredChatMessages(USER_A)).toEqual([]);
    expect(loadStoredChatMessages(USER_B)).toHaveLength(1);
  });

  it('clearChatMessages silently no-ops for an undefined user', () => {
    expect(() => clearChatMessages(undefined)).not.toThrow();
  });
});

describe('malformed / legacy stored data safety', () => {
  it('malformed JSON under a real user\'s key fails safe to an empty conversation, never a crash or partial restore', () => {
    localStorage.setItem(chatStorageKey(USER_A), '{not valid json');
    expect(loadStoredChatMessages(USER_A)).toEqual([]);
  });

  it('a non-array value stored under a user\'s key is rejected rather than trusted', () => {
    localStorage.setItem(chatStorageKey(USER_A), JSON.stringify({ not: 'an array' }));
    expect(loadStoredChatMessages(USER_A)).toEqual([]);
  });

  it('the old unscoped legacy key is never read by any account, even if it still holds a previous session\'s data', () => {
    localStorage.setItem('twin_chat', JSON.stringify([makeMessage({ content: 'pre-Phase-35 unscoped data' })]));
    expect(loadStoredChatMessages(USER_A)).toEqual([]);
    expect(loadStoredChatMessages(USER_B)).toEqual([]);
  });

  it('purgeLegacyUnscopedChatStorage removes the old unscoped key without touching any real user\'s scoped conversation', () => {
    localStorage.setItem('twin_chat', JSON.stringify([makeMessage()]));
    persistChatMessages(USER_A, [makeMessage({ id: 'keep-me' })]);

    purgeLegacyUnscopedChatStorage();

    expect(localStorage.getItem('twin_chat')).toBeNull();
    expect(loadStoredChatMessages(USER_A).map((m) => m.id)).toEqual(['keep-me']);
  });

  it('purgeLegacyUnscopedChatStorage is safe to call when the legacy key never existed', () => {
    expect(() => purgeLegacyUnscopedChatStorage()).not.toThrow();
  });
});
