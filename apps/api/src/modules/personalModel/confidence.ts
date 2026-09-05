import type { EpistemicStatus } from '@twin/contracts';
import { EPISTEMIC_STRENGTH } from '../graph/relationships.service.js';

/**
 * Item 5's confidence aggregation. Deliberately simple and documented
 * as a heuristic, not a calibrated probability: base confidence comes
 * from the single strongest piece of evidence (by epistemic strength,
 * ties broken by that observation's own confidence), and each
 * additional INDEPENDENT observation nudges confidence up slightly,
 * capped — repetition is corroborating but not proof, and a fact
 * mentioned in twenty near-identical memories should not read as
 * "100% certain" just because the count is high.
 *
 * This intentionally never lets a pile of low-status evidence (e.g.
 * ten 'probable' mentions) out-rank one 'explicit' statement — the
 * base always comes from the strongest tier present, matching item 3's
 * requirement that inference can never masquerade as explicit fact.
 */
export const REPEATED_OBSERVATION_BONUS = 0.05;
export const MAX_REPETITION_BONUS = 0.2;

export interface ConfidenceObservation {
  epistemicStatus: EpistemicStatus;
  confidence: number;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Pure — same input always produces the same output (item 15's determinism requirement). */
export function aggregateConfidence(observations: ConfidenceObservation[]): number {
  if (observations.length === 0) return 0;

  let strongestRank = -1;
  let base = 0;
  for (const obs of observations) {
    const rank = EPISTEMIC_STRENGTH[obs.epistemicStatus];
    if (rank > strongestRank || (rank === strongestRank && obs.confidence > base)) {
      strongestRank = rank;
      base = obs.confidence;
    }
  }

  const bonus = Math.min(REPEATED_OBSERVATION_BONUS * (observations.length - 1), MAX_REPETITION_BONUS);
  return clamp01(base + bonus);
}

/** The strongest epistemic status among a set of observations — same "strongest tier wins" rule the confidence aggregation uses, exposed separately since a fact's status and its confidence are tracked independently. */
export function strongestEpistemicStatus(observations: ConfidenceObservation[]): EpistemicStatus {
  let strongestRank = -1;
  let status: EpistemicStatus = 'probable';
  for (const obs of observations) {
    const rank = EPISTEMIC_STRENGTH[obs.epistemicStatus];
    if (rank > strongestRank) {
      strongestRank = rank;
      status = obs.epistemicStatus;
    }
  }
  return status;
}
