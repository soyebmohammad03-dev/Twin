import type { InsightDto } from '@twin/contracts';

/**
 * Phase 15: picks the single insight worth surfacing on the Home
 * screen. Home is a curated, one-item highlight (see HomeView's "Twin
 * Noticed" card) — deliberately NOT a second list view of the full
 * Insights section (Profile already owns that, unaffected by this
 * file), matching "avoid overwhelming the user" and "do not duplicate
 * the Insight system in the frontend".
 *
 * This does not fetch, rebuild, or write anything — it is a pure
 * selection over whatever the existing insightsApi.getInsights() call
 * already returned (server-scoped to the authenticated user, already
 * excludes dismissed insights). No new backend endpoint, no new
 * ranking on the server: GET /insights already orders by
 * (confidence desc, lastObservedAt desc), which is a reasonable
 * default for the full Profile list, but Home specifically wants
 * "what's currently worth my attention" — a resolved/superseded
 * tension (Phase 13) is exactly the kind of insight that should NOT
 * headline the Home screen even if its confidence score is still high,
 * since the pattern it describes is no longer active. Excluding it
 * here, client-side, over the already-fetched list, avoids adding a
 * second server-side ordering to maintain.
 *
 * Beyond that one exclusion, ranking blends confidence with recency:
 *
 *   homeScore = confidence * recencyWeight(lastObservedAt)
 *   recencyWeight = clamp(1 - ageDays / RECENCY_HALF_WINDOW_DAYS, MIN_RECENCY_WEIGHT, 1)
 *
 * A high-confidence insight that hasn't produced new evidence in a
 * while is still shown (the weight floors at MIN_RECENCY_WEIGHT,
 * never zero — an old-but-strong pattern shouldn't vanish entirely),
 * but a comparably-confident, MORE RECENT insight will usually win,
 * which is what "what changed recently" (the brief's own target
 * question) requires. This mirrors the shape of every backend
 * confidence/temporal heuristic already in this codebase (a documented,
 * bounded, deterministic formula — see
 * apps/api/src/modules/insights/confidence.ts) rather than inventing
 * an unrelated scoring system.
 */
const RECENCY_HALF_WINDOW_DAYS = 14;
const MIN_RECENCY_WEIGHT = 0.3;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function recencyWeight(lastObservedAt: string, now: Date): number {
  const ageDays = (now.getTime() - new Date(lastObservedAt).getTime()) / MS_PER_DAY;
  const raw = 1 - ageDays / RECENCY_HALF_WINDOW_DAYS;
  return Math.max(MIN_RECENCY_WEIGHT, Math.min(1, raw));
}

function homeScore(insight: InsightDto, now: Date): number {
  return insight.confidence * recencyWeight(insight.lastObservedAt, now);
}

/**
 * Returns the single highest-homeScore insight, or null if there are
 * none worth surfacing (empty list, or every insight is 'superseded').
 * Ties broken by lastObservedAt (most recent wins) for a deterministic
 * result — matters for repeated calls against the same snapshot, e.g.
 * re-render, not for anything persisted.
 */
export function selectTopInsight(insights: InsightDto[], now: Date = new Date()): InsightDto | null {
  const eligible = insights.filter((i) => i.temporalState !== 'superseded');
  if (eligible.length === 0) return null;

  return eligible.reduce((best, candidate) => {
    const bestScore = homeScore(best, now);
    const candidateScore = homeScore(candidate, now);
    if (candidateScore > bestScore) return candidate;
    if (candidateScore < bestScore) return best;
    return new Date(candidate.lastObservedAt) > new Date(best.lastObservedAt) ? candidate : best;
  });
}
