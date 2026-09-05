import type { InsightDto } from '@twin/contracts';

/**
 * Phase 21 — picks the patterns Deep Exploration surfaces, over the
 * SAME already-fetched insights list Profile's InsightsSection and
 * Home's homeInsight.ts read (GET /insights, already ordered by
 * confidence desc / lastObservedAt desc server-side — see that
 * endpoint's own doc comment). No new fetch, no new ranking on the
 * server, no rebuild triggered here: this is a pure client-side
 * selection, exactly like homeInsight.ts's selectTopInsight, just
 * returning up to `count` patterns instead of exactly one, since Deep
 * Exploration's "converging threads" framing is inherently plural.
 *
 * Excludes 'superseded' insights for the same reason Home does: a
 * pattern Twin no longer considers active shouldn't headline "what
 * Twin has noticed," even if its stored confidence is still high.
 */
export function selectExplorationInsights(insights: InsightDto[], count = 3): InsightDto[] {
  return insights.filter((i) => i.temporalState !== 'superseded').slice(0, count);
}
