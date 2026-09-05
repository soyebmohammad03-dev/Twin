import type { EpistemicStatus } from '@twin/contracts';
import { EPISTEMIC_STRENGTH } from '../graph/relationships.service.js';
import { NEGLECTED_GOAL_STALENESS_DAYS, NEGLECTED_GOAL_STABLE_DAYS } from './categories.js';

/**
 * Confidence for a neglected_goal insight — deliberately simple and
 * documented as a heuristic, not a calibrated probability (same
 * honesty disclaimer as personalModel/confidence.ts's
 * aggregateConfidence). It answers "how confident is Twin that this
 * is a genuine, meaningful gap" — not "how likely is this to be
 * true" in any statistical sense. Never rendered as a bare percentage
 * in the UI (see InsightsSection.tsx's qualitative bucket labels).
 *
 * Two independent signals, each capped, then summed and clamped:
 *  - evidenceStrength: a goal that was mentioned several times before
 *    going quiet is a much stronger "this was real and is now
 *    neglected" signal than a goal entity that was created once and
 *    never mentioned again (which could just be a stub, not a
 *    meaningful neglect pattern).
 *  - stalenessStrength: the longer the silence beyond the staleness
 *    threshold, up to the "stable" threshold, the more confident Twin
 *    can be this isn't just a brief lull.
 */
export function computeNeglectedGoalConfidence(input: { evidenceCount: number; daysSinceLastEvidence: number }): number {
  const evidenceStrength = input.evidenceCount === 0 ? 0.3 : Math.min(0.5 + 0.1 * input.evidenceCount, 0.8);

  const stalenessRange = Math.max(NEGLECTED_GOAL_STABLE_DAYS - NEGLECTED_GOAL_STALENESS_DAYS, 1);
  const stalenessProgress = Math.min(
    Math.max(input.daysSinceLastEvidence - NEGLECTED_GOAL_STALENESS_DAYS, 0) / stalenessRange,
    1,
  );
  const stalenessBonus = stalenessProgress * 0.2;

  return Math.max(0, Math.min(1, evidenceStrength * 0.8 + stalenessBonus));
}

/**
 * Confidence for a recurring_topic insight — deliberately derived
 * from Personal Model's ALREADY-COMPUTED fact confidence rather than
 * re-deriving anything from raw evidence (that aggregation already
 * happened once in personalModel/confidence.ts's aggregateConfidence;
 * duplicating it here would let the two numbers drift apart for no
 * reason). Two adjustments on top of the fact's own confidence:
 *  - a small bonus for observation counts well past the minimum
 *    threshold (a topic mentioned 10 times is a stronger pattern than
 *    one that just barely qualified at 3), capped so it can't dominate;
 *  - a discount when the pattern has gone quiet (isFading) — it WAS a
 *    real pattern, but Twin is less confident it still matters today.
 */
export function computeRecurringTopicConfidence(input: { factConfidence: number; observationCount: number; isFading: boolean }): number {
  const observationBonus = Math.min(0.05 * Math.max(input.observationCount - 3, 0), 0.15);
  const base = Math.min(input.factConfidence + observationBonus, 1);
  return Math.max(0, Math.min(1, input.isFading ? base * 0.7 : base));
}

/**
 * Confidence for a priority_tension insight. A tension is only as
 * credible as its WEAKER side — one confident, well-evidenced
 * preference sitting next to a barely-supported opposite one is a
 * much shakier "these conflict" claim than two equally strong,
 * explicit statements — so this deliberately takes the minimum of the
 * two facts' own confidence, not an average. The further 0.9 discount
 * reflects that a tension is inherently an interpretive claim (that
 * two statements relate to the same subject and pull against each
 * other) even when every underlying fact is itself fully certain.
 */
export function computePriorityTensionConfidence(input: { likeConfidence: number; dislikeConfidence: number }): number {
  return Math.max(0, Math.min(1, Math.min(input.likeConfidence, input.dislikeConfidence) * 0.9));
}

/**
 * Confidence for a relationship_tension insight — reuses
 * EPISTEMIC_STRENGTH (graph/relationships.service.ts), the same
 * ranking personalModel/confidence.ts's own aggregateConfidence
 * already imports, rather than inventing a second one. Two
 * deliberately separate discounts, both documented heuristics:
 *
 *  - the same "weakest side caps it, never full certainty" shape as
 *    computePriorityTensionConfidence — two current relationships
 *    existing is not itself proof of a meaningful tension;
 *  - an ADDITIONAL epistemic discount when the weaker side's
 *    epistemicStatus tier is low: an inferred or merely-probable
 *    relationship shouldn't produce as strong a "these conflict"
 *    signal as two explicitly-stated ones would, even at the same
 *    raw confidence number — this is the concrete mechanism behind
 *    "stronger evidence should appropriately outweigh weaker evidence."
 */
export function computeRelationshipTensionConfidence(input: {
  currentConfidence: number;
  currentEpistemicStatus: EpistemicStatus;
  priorConfidence: number;
  priorEpistemicStatus: EpistemicStatus;
}): number {
  const base = Math.min(input.currentConfidence, input.priorConfidence) * 0.9;
  const weakestStrength = Math.min(EPISTEMIC_STRENGTH[input.currentEpistemicStatus], EPISTEMIC_STRENGTH[input.priorEpistemicStatus]);
  const epistemicDiscount = weakestStrength <= EPISTEMIC_STRENGTH.probable ? 0.7 : weakestStrength <= EPISTEMIC_STRENGTH.inferred ? 0.85 : 1.0;
  return Math.max(0, Math.min(1, base * epistemicDiscount));
}

/**
 * Confidence for a cross_insight synthesis (Phase 14) — deliberately
 * the most conservative confidence formula in this file, because a
 * synthesis is the LEAST direct claim: an interpretation about how
 * several already-interpretive insights relate, not a claim about the
 * world itself.
 *
 *  - `min(...sourceConfidences)`: the synthesis is never more
 *    confident than its WEAKEST contributing source, same "weakest
 *    link" shape as computePriorityTensionConfidence and
 *    computeRelationshipTensionConfidence — one shaky source caps the
 *    whole thing, exactly the brief's "penalized when source insights
 *    are weak" requirement.
 *  - `anchorStrength` multiplier: an 'entity' anchor (two insights
 *    grounded in the literal same entity id) is a real, unambiguous
 *    shared referent; a 'text' anchor (priority_tension's free-text
 *    subject phrase happening to normalize-match an entity's name) is
 *    a heuristic bridge that could coincidentally collide — discounted
 *    further to reflect that weaker linkage.
 *  - a flat 0.8 interpretive-layer discount on top of both, so a
 *    synthesis NEVER reaches full certainty even when every source is
 *    itself fully explicit and the anchor is a strong entity match —
 *    it is Twin's own act of connecting things, not a fact restated
 *    from evidence.
 *  - `sourceCountBonus`: capped small bonus for more corroborating
 *    sources (3-4 vs the minimum 2), same spirit as
 *    computeRecurringTopicConfidence's observationBonus — more
 *    independent signals pointing at the same anchor is itself weak
 *    positive evidence, but never enough to outweigh a weak source or
 *    a weak anchor.
 */
export function computeCrossInsightConfidence(input: { sourceConfidences: number[]; anchorStrength: 'entity' | 'text' }): number {
  const weakest = Math.min(...input.sourceConfidences);
  const anchorMultiplier = input.anchorStrength === 'entity' ? 1.0 : 0.75;
  const sourceCountBonus = Math.min(0.03 * Math.max(input.sourceConfidences.length - 2, 0), 0.06);
  const base = weakest * anchorMultiplier * 0.8 + sourceCountBonus;
  return Math.max(0, Math.min(1, base));
}
