import type { Queryable } from '@twin/db';
import type { ChatConversationTurn, ContextPacket, GroundedResponse, IntentType } from '@twin/contracts';
import { buildContext, ContextError, type BuildContextInput } from '../context/contextEngine.js';
import type { RetrievalLogger } from '../retrieval/retrieval.service.js';
import { getReasoningProvider } from '../context/geminiReasoningProvider.js';
import {
  MockReasoningProvider,
  runReasoningSafely,
  validateGroundedResponse,
  type ReasoningProvider,
} from '../context/reasoningProvider.js';

export { ContextError };

export interface ChatEvidence {
  memories: ContextPacket['memories'];
  entities: ContextPacket['entities'];
  personalModelFacts: ContextPacket['personalModelFacts'];
  insights: ContextPacket['insights'];
}

export interface ChatResult extends GroundedResponse {
  intent: IntentType;
  evidence: ChatEvidence;
}

export interface SendChatMessageInput extends BuildContextInput {
  /** Recent turns of this same chat, oldest first, NOT including this new message — see chatRequestSchema. */
  conversationHistory?: ChatConversationTurn[];
}

/**
 * Projects an already-built ContextPacket down to only the items the
 * (already citation-validated) response actually cited — the exact
 * data behind Twin Chat's "Why does Twin think this?" panel. This is
 * never a second query and never re-derives anything: `packet` was
 * already fully assembled by buildContext, and `response`'s citation
 * arrays were already checked against that same packet by
 * validateGroundedResponse before this function ever runs, so every id
 * looked up here is guaranteed to exist in `packet`.
 */
export function buildChatEvidence(packet: ContextPacket, response: GroundedResponse): ChatEvidence {
  const memoryIds = new Set(response.citedMemoryIds);
  const entityIds = new Set(response.citedEntityIds);
  const factIds = new Set(response.citedPersonalModelFactIds);
  const insightIds = new Set(response.citedInsightIds);
  return {
    memories: packet.memories.filter((m) => memoryIds.has(m.memoryId)),
    entities: packet.entities.filter((e) => entityIds.has(e.entityId)),
    personalModelFacts: packet.personalModelFacts.filter((f) => factIds.has(f.factId)),
    insights: packet.insights.filter((i) => insightIds.has(i.insightId)),
  };
}

/**
 * Phase 20's Twin Chat orchestration — the ONE authoritative path from
 * a chat message to a grounded answer. It composes exactly the same
 * building blocks POST /context and POST /reason already use and
 * already have dedicated test coverage for:
 *
 *   buildContext()          -> retrieval + graph + Personal Model +
 *                               Insights, bounded by the same budget
 *                               every other caller gets (Phase 8/17)
 *   getReasoningProvider()  -> the same Gemini-or-Mock provider
 *                               resolution POST /reason uses (Phase 18)
 *   runReasoningSafely()    -> the same provider-failure fallback
 *   validateGroundedResponse() -> the same citation-integrity enforcement
 *
 * Nothing here re-implements retrieval, re-implements reasoning, or
 * introduces a second grounding contract — this function only adds (a)
 * bounded conversation history threaded through to the provider for
 * multi-turn continuity, and (b) the evidence panel projection above.
 * It never writes anything: no memory, insight, or Personal Model
 * mutation happens on this path, so a chat message can never become a
 * long-term memory just by being sent — only explicit capture/ingestion
 * (memories.service.ts / ingestion.service.ts) does that.
 */
export async function sendChatMessage(
  db: Queryable,
  userId: string,
  input: SendChatMessageInput,
  deps: { reasoningProvider?: ReasoningProvider; logger?: RetrievalLogger } = {},
): Promise<ChatResult> {
  const packet = await buildContext(db, userId, input, { logger: deps.logger });
  const provider = deps.reasoningProvider ?? getReasoningProvider() ?? new MockReasoningProvider();
  const raw = await runReasoningSafely(provider, packet, input.query, input.conversationHistory ?? []);
  const response = validateGroundedResponse(raw, packet);
  return {
    ...response,
    intent: packet.intent,
    evidence: buildChatEvidence(packet, response),
  };
}
