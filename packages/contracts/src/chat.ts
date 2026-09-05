import { z } from 'zod';
import {
  buildContextRequestSchema,
  contextMemoryItemSchema,
  contextEntityItemSchema,
  contextPersonalModelFactItemSchema,
  contextInsightItemSchema,
  groundedResponseSchema,
  intentTypeSchema,
} from './context.js';

/**
 * Phase 20's Twin Chat contract. Twin Chat is a thin, dedicated surface
 * over the SAME buildContext() + ReasoningProvider pipeline
 * POST /context and POST /reason already use (see
 * apps/api/src/modules/chat/chatService.ts) — this file only adds the
 * two things a chat UI specifically needs that the generic /reason
 * contract doesn't: bounded conversation history (for follow-up
 * continuity) on the request, and a compact evidence panel (for "Why
 * does Twin think this?") on the response, projected directly from the
 * ContextPacket that was already built — never a second retrieval.
 */

export const chatConversationRoleSchema = z.enum(['user', 'assistant']);
export type ChatConversationRole = z.infer<typeof chatConversationRoleSchema>;

/**
 * One prior turn of the SAME conversation, as the client already has it
 * (it's just chat transcript, not a stored server-side conversation).
 * Bounded to 20 turns / 4000 chars each — generous relative to what a
 * chat UI would ever need to send for continuity, but explicit rather
 * than unbounded, matching every other budget in this API.
 */
export const chatConversationTurnSchema = z.object({
  role: chatConversationRoleSchema,
  content: z.string().trim().min(1).max(4000),
});
export type ChatConversationTurn = z.infer<typeof chatConversationTurnSchema>;

/**
 * Identical to buildContextRequestSchema's optional-target/date-range/
 * graphHops/budget fields (never redefined — see that schema's own
 * comment) with `query` renamed to `message` for a chat-shaped API, plus
 * `conversationHistory`. A message is a single new turn; it is NEVER
 * itself written to long-term memory by this endpoint or its handler —
 * only explicit capture/ingestion persists a memory (see chatService.ts).
 */
export const chatRequestSchema = buildContextRequestSchema.omit({ query: true }).extend({
  message: z.string().trim().min(1, 'message must not be empty').max(2000, 'message is too long'),
  /** Most recent turns first-to-last (oldest first), NOT including this new message. Bounded — see the module comment on why this is never unlimited history. */
  conversationHistory: z.array(chatConversationTurnSchema).max(20).optional(),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

/**
 * A read-only projection of the ContextPacket sections that the
 * (citation-validated) response actually cited — the exact, and only,
 * data behind "Why does Twin think this?". Never re-fetched, never
 * re-derived: these are the literal items buildContext already
 * assembled for this turn, filtered down to the ones referenced by
 * citedMemoryIds/citedEntityIds/citedPersonalModelFactIds/citedInsightIds.
 */
export const chatEvidenceSchema = z.object({
  memories: z.array(contextMemoryItemSchema),
  entities: z.array(contextEntityItemSchema),
  personalModelFacts: z.array(contextPersonalModelFactItemSchema),
  insights: z.array(contextInsightItemSchema),
});
export type ChatEvidence = z.infer<typeof chatEvidenceSchema>;

export const chatResponseSchema = groundedResponseSchema.extend({
  /** The Context Engine's own classification of this turn — exposed so the UI can show what kind of question Twin understood this as, never re-derived client-side. */
  intent: intentTypeSchema,
  evidence: chatEvidenceSchema,
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;
