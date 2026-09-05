import {
  NEGLECTED_GOAL_STABLE_DAYS,
  RECURRING_TOPIC_STABLE_SPAN_DAYS,
  PRIORITY_TENSION_STABLE_DAYS,
  RELATIONSHIP_TENSION_STABLE_DAYS,
  RELATIONSHIP_TENSION_RESOLUTION_DAYS,
  CROSS_INSIGHT_STABLE_DAYS,
  DECISION_EVOLUTION_RECURRING_TRANSITIONS,
  DECISION_EVOLUTION_STABLE_DAYS,
} from './categories.js';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** The two temporalState values this insight type can ever produce — a strict subset of the contract's full InsightTemporalState enum (see the doc comment below). */
export type NeglectedGoalTemporalState = 'emerging' | 'stable';

/**
 * An insight's temporalState describes the PATTERN's own lifecycle —
 * distinct from personal_model_facts' temporalState, which describes
 * a single fact's currency. For 'neglected_goal' specifically, only
 * two of the six states are reachable: a candidate is only ever
 * generated once past the staleness threshold (see
 * insightsEngine.ts), so there is no "recurring" (neglect isn't a
 * repeating event) or "fading" (once new evidence appears the goal
 * simply stops being a candidate at all — see insightsStore.ts) for
 * this insight type. 'superseded' and 'unresolved' are reserved for
 * other insight types added in later slices, exactly like
 * personalModel's temporal.ts reserves 'unresolved' today.
 */
export function computeNeglectedGoalTemporalState(daysSinceLastEvidence: number): NeglectedGoalTemporalState {
  return daysSinceLastEvidence >= NEGLECTED_GOAL_STABLE_DAYS ? 'stable' : 'emerging';
}

/** The three temporalState values a recurring_topic insight can produce. */
export type RecurringTopicTemporalState = 'emerging' | 'stable' | 'fading';

/**
 * Derived from the underlying Personal Model fact's OWN already-
 * computed temporalState, not recomputed from scratch: when the fact
 * has gone stale ('historical', per personalModel/temporal.ts's
 * STALENESS_WINDOW_DAYS), the pattern is 'fading' — it was real, but
 * has gone quiet. Otherwise, a pattern sustained across a long span
 * (first to last observation) reads as 'stable'; one that only
 * recently crossed the recurrence threshold reads as 'emerging'.
 */
export function computeRecurringTopicTemporalState(
  personalModelTemporalState: string,
  firstObservedAt: Date,
  lastObservedAt: Date,
): RecurringTopicTemporalState {
  if (personalModelTemporalState === 'historical') return 'fading';
  const spanDays = (lastObservedAt.getTime() - firstObservedAt.getTime()) / MS_PER_DAY;
  return spanDays >= RECURRING_TOPIC_STABLE_SPAN_DAYS ? 'stable' : 'emerging';
}

/** The two temporalState values a priority_tension insight can produce — a tension either just appeared or has persisted; it has no "fading" analogue in this phase (a tension that stops holding simply stops being a candidate — see insightsStore.ts's resolve step). */
export type PriorityTensionTemporalState = 'emerging' | 'stable';

export function computePriorityTensionTemporalState(firstObservedAt: Date, now: Date): PriorityTensionTemporalState {
  const ageDays = (now.getTime() - firstObservedAt.getTime()) / MS_PER_DAY;
  return ageDays >= PRIORITY_TENSION_STABLE_DAYS ? 'stable' : 'emerging';
}

/**
 * The three temporalState values a relationship_tension insight can
 * produce. 'emerging'/'stable' are age-based, same shape as
 * priority_tension's. 'superseded' is Phase 13's addition: once
 * isRelationshipTensionResolved (below) determines every prior side of
 * the conflict has gone quiet for RELATIONSHIP_TENSION_RESOLUTION_DAYS,
 * the tension is no longer treated as actively contested — this reuses
 * the contract's existing insightTemporalStateSchema value (already
 * defined since Phase 10, never emitted by any detector until now) and
 * the frontend's existing TEMPORAL_LABEL entry for it
 * ("Replaced by something more recent"), so no contract or UI change
 * is needed to surface this.
 */
export type RelationshipTensionTemporalState = 'emerging' | 'stable' | 'superseded';

export function computeRelationshipTensionTemporalState(firstObservedAt: Date, now: Date, resolved: boolean): RelationshipTensionTemporalState {
  if (resolved) return 'superseded';
  const ageDays = (now.getTime() - firstObservedAt.getTime()) / MS_PER_DAY;
  return ageDays >= RELATIONSHIP_TENSION_STABLE_DAYS ? 'stable' : 'emerging';
}

/**
 * Phase 13's deterministic resolution rule — purely structural/temporal,
 * never text-based (no scanning evidence content for "no longer"/
 * "moved on"/etc, which risks exactly the "inferring resolution from
 * vague language" the brief warns against). A relationship_tension's
 * conflict group is considered resolved once EVERY prior (non-current)
 * side has gone at least RELATIONSHIP_TENSION_RESOLUTION_DAYS since its
 * own last evidence — i.e. nothing has reinforced the older claim in a
 * meaningful while, regardless of whether the current side itself has
 * received fresh evidence recently. `priorLastObservedAt` must be the
 * FULL set of non-current group members (not the evidence-display-
 * bounded MAX_RELATIONSHIP_TENSION_SIDES subset) — an evidence-bounded-
 * out prior can still keep a tension active. An empty array (should
 * never happen for a real conflict group, which always has >=1 prior)
 * is treated as resolved — vacuously true, and defensive rather than a
 * expected code path.
 */
export function isRelationshipTensionResolved(priorLastObservedAt: Date[], now: Date): boolean {
  return priorLastObservedAt.every((d) => (now.getTime() - d.getTime()) / MS_PER_DAY >= RELATIONSHIP_TENSION_RESOLUTION_DAYS);
}

/** The two temporalState values a cross_insight synthesis can produce — same age-based shape as priority_tension/relationship_tension's. No 'superseded' state: a synthesis whose sources go stale simply stops being generated as a candidate and is resolved away by the existing hard-delete-on-disappearance lifecycle (see insightsStore.ts) — the same mechanism neglected_goal/recurring_topic/priority_tension already use, since (unlike relationship_tension's permanent entity_relationships rows) a synthesis's sources are themselves freshly-recomputed candidates each rebuild, so there's no permanent underlying row that would otherwise linger forever. */
export type CrossInsightTemporalState = 'emerging' | 'stable';

export function computeCrossInsightTemporalState(firstObservedAt: Date, now: Date): CrossInsightTemporalState {
  const ageDays = (now.getTime() - firstObservedAt.getTime()) / MS_PER_DAY;
  return ageDays >= CROSS_INSIGHT_STABLE_DAYS ? 'stable' : 'emerging';
}

/**
 * The three temporalState values a decision_evolution insight can
 * produce. 'recurring' is a purely structural signal (a real transition
 * COUNT threshold, not age) — a decision reconsidered three or more
 * times is repeatedly, actively unsettled regardless of when. Below
 * that, 'emerging'/'stable' are age-based on the most recent transition,
 * same shape as priority_tension's.
 */
export type DecisionEvolutionTemporalState = 'emerging' | 'recurring' | 'stable';

export function computeDecisionEvolutionTemporalState(transitionCount: number, lastObservedAt: Date, now: Date): DecisionEvolutionTemporalState {
  if (transitionCount >= DECISION_EVOLUTION_RECURRING_TRANSITIONS) return 'recurring';
  const ageDays = (now.getTime() - lastObservedAt.getTime()) / MS_PER_DAY;
  return ageDays >= DECISION_EVOLUTION_STABLE_DAYS ? 'stable' : 'emerging';
}
