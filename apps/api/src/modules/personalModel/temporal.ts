import type { FactTemporalState } from '@twin/contracts';

/**
 * Item 7's temporal model. A fact's evidence recency determines
 * current vs. historical; a detected conflict (see conflicts.ts) can
 * additionally mark the OLDER side of that conflict 'superseded'
 * rather than merely 'historical' — a stronger, more specific claim
 * ("something replaced this") than plain staleness. 'unresolved' is
 * defined in the contract for future use but this phase's deterministic
 * generator never emits it — nothing in the current schema grounds an
 * "open question with no evidence either way" state distinct from
 * uncertain/needs-confirmation, which is already covered by low
 * confidence.
 *
 * STALENESS_WINDOW_DAYS is an initial, documented heuristic (same
 * spirit as retrieval/ranking.ts's RECENCY_HALF_LIFE_DAYS) — not
 * tuned. A fact whose most recent evidence is older than this is
 * "historical", not because it's false, but because Twin hasn't heard
 * about it recently.
 */
export const STALENESS_WINDOW_DAYS = 60;

export function computeTemporalState(
  lastObservedAt: Date,
  now: Date,
  options: { supersededByNewer: boolean },
): FactTemporalState {
  if (options.supersededByNewer) return 'superseded';
  const ageMs = now.getTime() - lastObservedAt.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays > STALENESS_WINDOW_DAYS ? 'historical' : 'current';
}
