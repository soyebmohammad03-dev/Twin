/**
 * Phase 24 — pure, no-network derivations for HomeView's "Right Now"
 * surface. Mirrors homeInsight.ts's role (the existing Phase 15
 * curated-single-highlight pattern) but over Personal Model facts and
 * the user's own memory list instead of insights. Nothing here fetches
 * or invents data: every function is a deterministic selection over
 * whatever the caller already loaded from a real API.
 */

import type { PersonalModelCategory, PersonalModelChangeDto, PersonalModelFactDto } from '@twin/contracts';
import type { MemoryItem } from '../types';

/**
 * Which Personal Model category best answers "what matters right now"
 * — current priorities are the most direct answer to that question,
 * then whatever the user is actively working on, then longer-horizon
 * goals, then decisions. Categories not listed here (knowledge_areas,
 * recurring_topics, preferences, constraints, important_people) are
 * descriptive rather than "what's active right now", so they're never
 * chosen as the Home focus fact — Digital Twin Overview (Phase 23) is
 * where the full model lives.
 */
const FOCUS_CATEGORY_PRIORITY: readonly PersonalModelCategory[] = [
  'current_priorities',
  'active_projects',
  'goals',
  'decisions',
];

/**
 * Picks the single Personal Model fact Home should highlight as "what
 * matters right now" — the highest-priority category with any current
 * (non-dismissed — callers pass PersonalModelResponse.facts, which the
 * API already filters to non-dismissed) fact, breaking ties within
 * that category by most-recently-observed. Returns null when the user
 * has no facts in any of the eligible categories yet — Home must show
 * an honest empty state rather than reaching into a less relevant
 * category just to have something to display.
 */
export function selectFocusFact(facts: PersonalModelFactDto[]): PersonalModelFactDto | null {
  for (const category of FOCUS_CATEGORY_PRIORITY) {
    const candidates = facts.filter((f) => f.category === category);
    if (candidates.length === 0) continue;
    return candidates.reduce((best, candidate) =>
      new Date(candidate.lastObservedAt) > new Date(best.lastObservedAt) ? candidate : best,
    );
  }
  return null;
}

/**
 * The memory Home offers as "continue where you left off" — simply the
 * most recent memory, if any. Callers pass the already-loaded
 * `memories` list, which the real Memory API already returns ordered
 * newest-first (see memories.service.ts's orderBy), so this never
 * re-sorts; it stays a thin, obviously-correct wrapper specifically so
 * "the most recent memory" is a named, independently testable concept
 * rather than an inline `memories[0]` scattered through HomeView.
 */
export function selectContinuationMemory(memories: MemoryItem[]): MemoryItem | null {
  return memories[0] ?? null;
}

/** Real memories whose real `occurredAtIso` falls on the same calendar day as `now` (local time) — used for an honest "captured N today" count, never a fabricated activity figure. */
export function countMemoriesToday(memories: MemoryItem[], now: Date = new Date()): number {
  return memories.filter((m) => isSameCalendarDay(new Date(m.occurredAtIso), now)).length;
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Home's curated "Recent Intelligence" feed shows at most `limit` real
 * change-log rows (GET /twin/model/changes, already ordered newest
 * first) — but unlike Profile's full Model Evolution history (which
 * intentionally shows every row uncollapsed), a repeated rebuild-on-
 * every-Profile-visit can legitimately re-log the same description
 * back-to-back (e.g. the rebuild engine re-detecting the same "new
 * priority" transition on a later rebuild that didn't change anything
 * else). Every individual row is still real — this only collapses
 * consecutive duplicate descriptions so Home's small curated slot
 * doesn't read as broken/repetitive, never merges rows that differ or
 * reaches further back in history than `limit` distinct entries.
 */
export function selectRecentDistinctChanges(changes: PersonalModelChangeDto[], limit: number): PersonalModelChangeDto[] {
  const result: PersonalModelChangeDto[] = [];
  let lastDescription: string | null = null;
  for (const change of changes) {
    if (change.description === lastDescription) continue;
    result.push(change);
    lastDescription = change.description;
    if (result.length >= limit) break;
  }
  return result;
}

export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

/** Deterministic clock-time bucket for the Home greeting — this is the current time, not a claim about the user, so it carries no epistemic status. */
export function timeOfDay(now: Date = new Date()): TimeOfDay {
  const hour = now.getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}
