/**
 * Client for Phase 20's Twin Chat endpoint (apps/api/src/modules/chat).
 * See apiClient.ts for the shared authenticated-fetch plumbing every
 * Twin API client uses. This is a thin wrapper over POST /chat — it
 * does no local reasoning, no local answer generation, and no local
 * memory writes; every field on the returned ChatResponse comes
 * straight from the backend's Context Engine + ReasoningProvider.
 */

import type { ChatConversationTurn, ChatResponse } from '@twin/contracts';
import { authorizedFetch, parseOrThrow } from './apiClient';

export interface SendChatMessageInput {
  message: string;
  /** Bounded, oldest-first recent turns — see chatApi's callers for how this is trimmed. */
  conversationHistory?: ChatConversationTurn[];
  /**
   * Phase 28: when a chat turn originates from a specific entity (e.g.
   * Explore's "Ask Twin about this"), pass its real id so the backend's
   * Context Engine grounds the answer in that exact entity via
   * buildContext's explicit-target path — instead of relying on the
   * model to re-find the entity by fuzzily matching its name inside
   * free text. The backend (chatRequestSchema/chat.routes.ts) already
   * accepted this field; only the frontend never sent it before now.
   */
  targetEntityId?: string;
}

export const chatApi = {
  async send(input: SendChatMessageInput): Promise<ChatResponse> {
    const response = await authorizedFetch('/chat', { method: 'POST', body: JSON.stringify(input) });
    return parseOrThrow<ChatResponse>(response);
  },
};
