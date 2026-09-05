import type { InsightType } from '@twin/contracts';

/**
 * The insight types this phase actually derives from grounded data.
 * Phase 10 shipped 'neglected_goal' (smallest evidence surface, a
 * fact about the ABSENCE of evidence rather than an interpretation of
 * behavior). Phase 11 adds 'recurring_topic' and 'priority_tension' —
 * both derived entirely from already-computed personal_model_facts
 * rows (see insightsEngine.ts), not from a new memory/entity scan.
 * Phase 12 adds 'relationship_tension', derived directly from the
 * knowledge graph (entity_relationships + relationship_evidence),
 * reusing personalModel/conflicts.ts's detectRelationshipConflicts.
 * Phase 14 adds 'cross_insight', synthesized from >=2 of the FOUR
 * types above sharing a concrete anchor — never from another
 * cross_insight (see MAX_SYNTHESIS_DEPTH below).
 */
export const INSIGHT_TYPES: readonly InsightType[] = [
  'neglected_goal',
  'recurring_topic',
  'priority_tension',
  'relationship_tension',
  'cross_insight',
  'decision_evolution',
];

// ---------------------------------------------------------------------------
// Phase 14: cross-insight synthesis constants. All deliberately
// conservative and documented heuristics, same spirit as every
// threshold above — not independently tuned against real usage data.
// ---------------------------------------------------------------------------

/** A synthesis needs at least this many contributing first-order insights — never synthesize from a single signal alone. */
export const MIN_SYNTHESIS_SOURCES = 2;

/** Among a synthesis's contributing sources, at least this many DISTINCT insightTypes must be represented — two recurring_topic instances on the same anchor (impossible today, since each detector already dedupes per anchor, but defensive) would not itself be a higher-order pattern. */
export const MIN_DISTINCT_SOURCE_TYPES = 2;

/** Bounds evidence size and title/description length when many first-order insights share one anchor — same bounding spirit as MAX_RELATIONSHIP_TENSION_SIDES. */
export const MAX_SYNTHESIS_SOURCES = 4;

/** A first-order insight whose own lastObservedAt is older than this many days is excluded from contributing to a NEW or continuing synthesis — the temporal-reasoning requirement that ancient and current signals not be silently combined. Same order of magnitude as personalModel's STALENESS_WINDOW_DAYS (60). */
export const MAX_SYNTHESIS_SOURCE_AGE_DAYS = 60;

/** A first-order insight below this confidence never contributes to a synthesis — a weak/hypothesis-tier signal shouldn't help justify a higher-order claim. */
export const MIN_SYNTHESIS_SOURCE_CONFIDENCE = 0.35;

/** A synthesis sustained across at least this many days (earliest contributing source's firstObservedAt to now) reads as 'stable' rather than 'emerging'. Same shape as the other STABLE_DAYS constants. */
export const CROSS_INSIGHT_STABLE_DAYS = 14;

/**
 * Synthesis operates on first-order insights ONLY — never on another
 * cross_insight. This is enforced STRUCTURALLY (the candidate pool
 * insightsEngine.ts builds cross-insight synthesis from never includes
 * 'cross_insight' rows in the first place — see
 * computeAllInsightCandidates), not by a runtime depth counter; this
 * constant exists to document and test that boundary explicitly rather
 * than leave it as an unstated assumption.
 */
export const MAX_SYNTHESIS_DEPTH = 1;

/** Personal Model fact temporalState values that mean the user (or a later rebuild) has already moved past this claim — never used to back a NEW insight, exactly Phase 9.1's "superseded evidence must not silently continue supporting a current insight" rule applied to Phase 11. */
export const SUPERSEDED_FACT_TEMPORAL_STATES: readonly string[] = ['outdated', 'superseded'];

/** A recurring-topic pattern sustained across at least this many days (first to last observation) reads as 'stable' rather than 'emerging'. Documented heuristic, not tuned. */
export const RECURRING_TOPIC_STABLE_SPAN_DAYS = 30;

/** Both sides of a preference tension must have coexisted at least this many days before it's treated as 'stable' rather than a possibly-transient 'emerging' one. */
export const PRIORITY_TENSION_STABLE_DAYS = 14;

/** Goal statuses that mean the user already resolved this goal one way or another — never flagged as neglected regardless of recency. */
export const RESOLVED_GOAL_STATUSES: readonly string[] = ['achieved', 'abandoned'];

/**
 * A goal with no supporting evidence (a memory mentioning it) for at
 * least this many days becomes a candidate 'neglected_goal' insight.
 * Documented heuristic, not tuned — deliberately generous so a goal
 * that's simply quiet for a couple of weeks isn't flagged.
 */
export const NEGLECTED_GOAL_STALENESS_DAYS = 30;

/** Neglected for at least this many days -> temporalState 'stable' (a long-standing pattern) instead of 'emerging' (just crossed the threshold). */
export const NEGLECTED_GOAL_STABLE_DAYS = 90;

/** A rebuild scans a bounded slice of a user's goals, not their entire history — same bounding spirit as personalModel's MAX_ENTITIES_SCANNED. */
export const MAX_GOALS_SCANNED = 200;

/** How many of the most-recent supporting memories are attached as evidence rows per insight — bounded so one long-lived goal can't produce an unbounded evidence trail. */
export const MAX_EVIDENCE_MEMORIES_PER_INSIGHT = 5;

/** A rebuild scans a bounded slice of a user's entities when looking for relationship tensions — same bounding spirit and value as personalModel's own MAX_ENTITIES_SCANNED. */
export const MAX_RELATIONSHIP_SCAN_ENTITIES = 500;

/** Both sides of a relationship tension must have coexisted at least this many days before it's treated as 'stable' rather than a possibly-transient 'emerging' one. Same shape as PRIORITY_TENSION_STABLE_DAYS, kept as its own constant rather than shared — relationship tensions and preference tensions are different phenomena that happen to share a lifecycle shape. */
export const RELATIONSHIP_TENSION_STABLE_DAYS = 14;

/** How many "prior" (older, conflicting) relationships are attached as evidence per relationship_tension insight, beyond the single "current" one — bounds evidence size when a fromEntity+relationshipType group has more than 2 distinct targets. */
export const MAX_RELATIONSHIP_TENSION_SIDES = 3;

/** How many of a relationship's own relationship_evidence rows are copied as memory-evidence per side of a relationship_tension insight — same bounding spirit as MAX_EVIDENCE_MEMORIES_PER_INSIGHT. */
export const MAX_EVIDENCE_MEMORIES_PER_RELATIONSHIP_SIDE = 3;

/**
 * Phase 13: a "prior" (non-current) side of a relationship_tension is
 * considered SETTLED — no longer contesting which relationship is
 * current — once its own lastObservedAt (the newest evidence it has
 * ever received) has gone this many days without any further
 * reinforcement. Once every prior side in a group is settled, the
 * tension as a whole is resolved (temporalState becomes 'superseded'),
 * even though the underlying entity_relationships rows themselves are
 * never deleted or rewritten — see insights/temporal.ts's
 * isRelationshipTensionResolved. Deliberately larger than
 * RELATIONSHIP_TENSION_STABLE_DAYS (14): a tension should generally
 * have already become 'stable' before it can resolve, and this should
 * be a meaningfully longer silence than "just noticed." Same order of
 * magnitude as NEGLECTED_GOAL_STALENESS_DAYS/RECURRING_TOPIC_STABLE_SPAN_DAYS's
 * existing 30-day heuristic — not independently tuned.
 */
export const RELATIONSHIP_TENSION_RESOLUTION_DAYS = 30;

// ---------------------------------------------------------------------------
// Phase 37: decision_evolution — derived directly from decision_history
// (packages/db/src/schema/decisionHistory.ts), Phase 36's append-only
// record of a decision's real status/outcome/decidedAt transitions.
// Every row there is a genuine user-triggered change, never inferred —
// so a single real transition is already sufficient evidence that a
// decision "evolved," unlike e.g. neglected_goal's absence-based signal.
// ---------------------------------------------------------------------------

/** A decision needs at least this many real recorded transitions to qualify — decision_history only ever contains genuine transitions (Phase 36), so even one is real evidence of evolution. */
export const MIN_DECISION_HISTORY_ENTRIES = 1;

/** A rebuild scans a bounded slice of a user's decisions, not their entire history — same bounding spirit as MAX_GOALS_SCANNED. */
export const MAX_DECISIONS_SCANNED = 200;

/** How many of a decision's most-recent history rows are attached as evidence per insight — bounds evidence size for a decision with a long transition history, same spirit as MAX_EVIDENCE_MEMORIES_PER_INSIGHT. */
export const MAX_EVIDENCE_HISTORY_PER_INSIGHT = 5;

/** A decision with at least this many real transitions reads as 'recurring' (repeatedly reconsidered) regardless of age — a structural signal, not an age-based one. */
export const DECISION_EVOLUTION_RECURRING_TRANSITIONS = 3;

/** Below the recurring threshold, a decision whose most recent transition is at least this many days old reads as 'stable' rather than 'emerging' (just changed). */
export const DECISION_EVOLUTION_STABLE_DAYS = 14;
