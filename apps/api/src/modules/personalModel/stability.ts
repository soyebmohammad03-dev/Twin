import type { FactStability } from '@twin/contracts';

/**
 * Item 9's stable/changing/one-off distinction. A pure function of how
 * many independent observations support a fact and whether a conflict
 * was detected for it elsewhere in the pipeline (see conflicts.ts) —
 * never of the observations' content itself.
 *
 * 'one_off': exactly one supporting observation. This does NOT mean
 * the fact is false — item 3's own example ("I love dark mode", one
 * explicit statement) is a perfectly valid one_off/explicit fact. What
 * it means is "this hasn't been corroborated yet", which is exactly
 * the signal item 9's Rust example needs: a single 'inferred'/
 * 'probable' one_off observation is what routes a fact to
 * uncertain/needs-confirmation instead of a confident category list
 * (see categories.ts's UNCERTAIN_CONFIDENCE_THRESHOLD + the confidence
 * aggregation in confidence.ts, which keeps a lone inferred/probable
 * observation's confidence low by construction).
 *
 * 'changing': set by the caller when a conflict was detected for this
 * fact's subject (see conflicts.ts) — evidence disagrees, not just "not
 * yet corroborated".
 *
 * 'stable': at least STABLE_MIN_OBSERVATIONS independent observations
 * and no detected conflict.
 */
export const STABLE_MIN_OBSERVATIONS = 2;

export function computeStability(observationCount: number, hasConflict: boolean): FactStability {
  if (hasConflict) return 'changing';
  if (observationCount <= 1) return 'one_off';
  return observationCount >= STABLE_MIN_OBSERVATIONS ? 'stable' : 'one_off';
}
