import type { DecisionContext, DecisionStatus } from '@twin/contracts';

/**
 * The deterministic core of "Step 6" — a pure, no-I/O, no-LLM
 * classification of what's structurally KNOWN vs UNKNOWN about a
 * decision, built only from rows already fetched by the caller (the
 * decision's own status/outcome/decidedAt, plus counts of its graph
 * relationships and linked memories). Never invents a pro, a con,
 * a criterion, or an alternative that wasn't actually recorded — an
 * empty relationships/memories list produces an honest "not recorded"
 * statement, not a fabricated one.
 *
 * Phase 27: a linked memory (memory_entities, role='related') is NOT
 * automatically "evidence" for any specific claim — that word is
 * reserved for relationship_evidence, the actual evidence trail behind
 * a relationship edge (see relationships.service.ts). This function
 * (and the `hasEvidence` field it returns — kept as-is since it's an
 * established API field name, see decisions.ts's schema comment) means
 * "something is linked," not "a claim is evidenced" — the copy below
 * says "linked," never "evidence," for exactly that reason.
 *
 * The free-text "why" explanation is a SEPARATE concern, answered by
 * calling the existing POST /reason endpoint with this decision's
 * entity id (see docs/architecture.md's ReasoningProvider contract) —
 * this function never talks to a reasoning provider.
 */
export function buildDecisionContext(input: {
  status: DecisionStatus;
  outcome: string | null;
  decidedAt: string | null;
  relationshipCount: number;
  linkedMemoryCount: number;
}): DecisionContext {
  const { status, outcome, decidedAt, relationshipCount, linkedMemoryCount } = input;

  const known: string[] = [`Status: ${humanizeStatus(status)}`];
  if (outcome) known.push(`Chosen option: ${outcome}`);
  if (decidedAt) known.push(`Decided on ${new Date(decidedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`);

  const unknown: string[] = [];
  if (!outcome) {
    unknown.push('No chosen option/outcome has been recorded yet.');
  }
  if (status === 'open' && !decidedAt) {
    unknown.push('No decision date recorded — this decision is still open.');
  }
  if (relationshipCount === 0) {
    unknown.push('No related people, projects, goals, or alternatives have been linked to this decision.');
  }
  if (linkedMemoryCount === 0) {
    unknown.push('No memories have been linked to this decision yet.');
  }
  if (status === 'decided' || status === 'reversed') {
    unknown.push('What actually happened as a result of this decision has not been recorded — Twin does not yet track post-decision outcomes.');
  }

  return {
    known,
    unknown,
    hasEvidence: relationshipCount > 0 || linkedMemoryCount > 0,
  };
}

function humanizeStatus(status: DecisionStatus): string {
  if (status === 'open') return 'Open (undecided)';
  if (status === 'decided') return 'Decided';
  return 'Reversed';
}
