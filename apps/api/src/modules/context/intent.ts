import type { EntityType, IntentType } from '@twin/contracts';

/**
 * Item 10's intent classification — deterministic and entity-based by
 * design ("do not make this unnecessarily AI-dependent"). Precedence
 * below is a documented, initial heuristic, not a claim of optimality:
 * more specific intents (comparison, timeline, decision/project/person/
 * planning) are checked before falling back to "some entity matched"
 * (factual_recall) and finally "nothing recognized" (general_knowledge).
 *
 * `IntentClassifier` is async so a future LLM-backed classifier can
 * implement the same interface without a breaking change — but per
 * item 10, an LLM classifier must never itself touch the database; it
 * would only ever see the same plain-text/entity-type input this one
 * does.
 */

export interface IntentClassifierInput {
  query: string;
  /** Entity types present among entities the request already resolved — either named directly in the query text or passed as explicit target/person/project/goal/decision ids. Does not include graph-expanded entities (those are a *result* of retrieval, not an input to understanding intent). */
  matchedEntityTypes: EntityType[];
  explicitTargets: {
    person: boolean;
    project: boolean;
    goal: boolean;
    decision: boolean;
  };
}

export interface IntentClassification {
  intent: IntentType;
  confidence: number;
  /** Which rule(s) fired — deterministic and inspectable, never a free-text explanation invented after the fact. */
  signals: string[];
}

export interface IntentClassifier {
  classify(input: IntentClassifierInput): Promise<IntentClassification>;
}

const COMPARISON_PATTERN = /\b(vs\.?|versus|compare[d]?|difference between|better than)\b/i;
const TIMELINE_PATTERN = /\b(history|timeline|over time|before|after|when did|changed|evolution|used to|used to be)\b/i;
const DECISION_PATTERN = /\b(decide[d]?|decision|chose|choice)\b/i;
const PROJECT_PATTERN = /\bproject\b/i;
const PERSON_PATTERN = /\bwho\b/i;
const PLANNING_PATTERN = /\b(plan|planning|goal|next steps|roadmap)\b/i;

function hasType(types: EntityType[], type: EntityType): boolean {
  return types.includes(type);
}

/** The deterministic rule set itself — a pure function, directly unit-testable without a classifier instance. */
export function classifyIntentDeterministic(input: IntentClassifierInput): IntentClassification {
  const { query, matchedEntityTypes, explicitTargets } = input;

  if (COMPARISON_PATTERN.test(query)) {
    return { intent: 'comparison', confidence: 0.7, signals: ['query contains a comparison marker'] };
  }

  if (TIMELINE_PATTERN.test(query)) {
    return { intent: 'timeline_recall', confidence: 0.7, signals: ['query contains a timeline/history marker'] };
  }

  if (explicitTargets.decision || hasType(matchedEntityTypes, 'decision')) {
    return {
      intent: 'decision_recall',
      confidence: 0.9,
      signals: [explicitTargets.decision ? 'caller passed decisionEntityId' : 'query named a decision entity'],
    };
  }
  if (DECISION_PATTERN.test(query)) {
    return { intent: 'decision_recall', confidence: 0.6, signals: ['query contains a decision-related word'] };
  }

  if (explicitTargets.project || hasType(matchedEntityTypes, 'project')) {
    return {
      intent: 'project_recall',
      confidence: 0.9,
      signals: [explicitTargets.project ? 'caller passed projectEntityId' : 'query named a project entity'],
    };
  }
  if (PROJECT_PATTERN.test(query)) {
    return { intent: 'project_recall', confidence: 0.6, signals: ["query contains the word 'project'"] };
  }

  if (explicitTargets.person || hasType(matchedEntityTypes, 'person')) {
    return {
      intent: 'person_recall',
      confidence: 0.9,
      signals: [explicitTargets.person ? 'caller passed personEntityId' : 'query named a person entity'],
    };
  }
  if (PERSON_PATTERN.test(query)) {
    return { intent: 'person_recall', confidence: 0.5, signals: ["query contains 'who'"] };
  }

  if (explicitTargets.goal || hasType(matchedEntityTypes, 'goal')) {
    return {
      intent: 'planning_context',
      confidence: 0.9,
      signals: [explicitTargets.goal ? 'caller passed goalEntityId' : 'query named a goal entity'],
    };
  }
  if (PLANNING_PATTERN.test(query)) {
    return { intent: 'planning_context', confidence: 0.6, signals: ['query contains a planning-related word'] };
  }

  if (matchedEntityTypes.length > 0) {
    return { intent: 'factual_recall', confidence: 0.5, signals: ['query or targets matched a known entity'] };
  }

  return { intent: 'general_knowledge', confidence: 0.3, signals: ['no entity, keyword, or explicit target matched'] };
}

export class DeterministicIntentClassifier implements IntentClassifier {
  async classify(input: IntentClassifierInput): Promise<IntentClassification> {
    return classifyIntentDeterministic(input);
  }
}
