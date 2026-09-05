import type { EpistemicStatus, EpistemicTier } from '@twin/contracts';

/**
 * Item 3's evidence hierarchy, made concrete and deterministic. A pure
 * function of (epistemicStatus, confidence) — never of memory content,
 * never an LLM call. Applied identically to memories and relationships
 * (both carry the same epistemicStatus/confidence pair).
 *
 * HIGH  — direct user statements ('explicit' memories are always high;
 *         Twin was told this directly, so confidence doesn't gate it).
 * MEDIUM — information from external sources ('from_source'), reported
 *         information ('reported_by_other'), and 'inferred' evidence
 *         that cleared the well-supported confidence bar below.
 * LOW   — 'probable' (definitionally uncertain) and 'inferred' evidence
 *         that did NOT clear that bar — a weak association.
 *
 * The 0.7 threshold is an initial, hand-picked heuristic (matching the
 * style of ranking.ts's DEFAULT_RANKING_WEIGHTS) — not the result of
 * any tuning or evaluation.
 */
export const INFERRED_WELL_SUPPORTED_CONFIDENCE_THRESHOLD = 0.7;

export function computeEpistemicTier(status: EpistemicStatus, confidence: number): EpistemicTier {
  switch (status) {
    case 'explicit':
      return 'high';
    case 'from_source':
    case 'reported_by_other':
      return 'medium';
    case 'inferred':
      return confidence >= INFERRED_WELL_SUPPORTED_CONFIDENCE_THRESHOLD ? 'medium' : 'low';
    case 'probable':
      return 'low';
  }
}

/** Ordering for sorting by tier strength, high first — used by relationship/evidence selection. */
export const EPISTEMIC_TIER_RANK: Record<EpistemicTier, number> = {
  high: 2,
  medium: 1,
  low: 0,
};
