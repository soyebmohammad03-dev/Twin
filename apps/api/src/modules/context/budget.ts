import type { ContextBudget, ContextBudgetInput } from '@twin/contracts';

/**
 * Item 6's configurable context budget. These defaults are an initial,
 * hand-picked heuristic (same spirit as retrieval/ranking.ts's
 * DEFAULT_RANKING_WEIGHTS) — small enough to keep a packet "compact"
 * and cheap to hand to an LLM later, not the result of any tuning
 * against real token limits or evaluation.
 */
export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  maxMemories: 12,
  maxEntities: 15,
  maxRelationships: 10,
  maxEvidencePerRelationship: 3,
  maxContentCharsPerMemory: 600,
  // Phase 17: same "small, hand-picked, not tuned" spirit — a packet's
  // Personal Model/Insight sections are meant as compact connective
  // context, not a second copy of Profile's full lists.
  maxPersonalModelFacts: 10,
  maxInsights: 8,
};

/** Merges a caller-supplied partial budget over the defaults — every field is independently optional. */
export function resolveContextBudget(input: ContextBudgetInput | undefined): ContextBudget {
  return { ...DEFAULT_CONTEXT_BUDGET, ...input };
}

/**
 * Truncates memory content to the budget's per-memory character limit,
 * cutting on a word boundary where possible rather than mid-word, so a
 * reasoning layer never sees a word sheared in half. Returns the
 * original content unchanged (and truncated=false) when it already
 * fits.
 */
export function truncateContent(content: string, maxChars: number): { content: string; truncated: boolean } {
  if (content.length <= maxChars) return { content, truncated: false };
  const hardCut = content.slice(0, maxChars);
  const lastSpace = hardCut.lastIndexOf(' ');
  const cut = lastSpace > maxChars * 0.5 ? hardCut.slice(0, lastSpace) : hardCut;
  return { content: `${cut}…`, truncated: true };
}

/** A rough, documented estimate (chars / 4) — not a real tokenizer. Good enough to record in truncation info per item 6, not meant to be precise. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
