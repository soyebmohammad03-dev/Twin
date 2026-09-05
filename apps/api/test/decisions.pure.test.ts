import { describe, expect, it } from 'vitest';
import { buildDecisionContext } from '../src/modules/decisions/decisionContext.js';

/** Pure, no-DB/no-LLM tests for the deterministic KNOWN/UNKNOWN decision classifier. */
describe('buildDecisionContext', () => {
  it('a brand-new open decision with nothing linked is honestly almost entirely unknown', () => {
    const ctx = buildDecisionContext({
      status: 'open',
      outcome: null,
      decidedAt: null,
      relationshipCount: 0,
      linkedMemoryCount: 0,
    });
    expect(ctx.known).toEqual(['Status: Open (undecided)']);
    expect(ctx.unknown).toContain('No chosen option/outcome has been recorded yet.');
    expect(ctx.unknown).toContain('No decision date recorded — this decision is still open.');
    expect(ctx.unknown).toContain('No related people, projects, goals, or alternatives have been linked to this decision.');
    expect(ctx.unknown).toContain('No memories have been linked to this decision yet.');
    expect(ctx.hasEvidence).toBe(false);
  });

  it('a decided decision with a recorded outcome and date reports both as known', () => {
    const ctx = buildDecisionContext({
      status: 'decided',
      outcome: 'Chose the remote-first option',
      decidedAt: '2026-01-15T00:00:00.000Z',
      relationshipCount: 2,
      linkedMemoryCount: 3,
    });
    expect(ctx.known).toContain('Status: Decided');
    expect(ctx.known).toContain('Chosen option: Chose the remote-first option');
    expect(ctx.known.some((k) => k.startsWith('Decided on'))).toBe(true);
    expect(ctx.unknown).not.toContain('No chosen option/outcome has been recorded yet.');
    expect(ctx.unknown).not.toContain('No related people, projects, goals, or alternatives have been linked to this decision.');
    expect(ctx.hasEvidence).toBe(true);
  });

  it('never claims a post-decision outcome was recorded — that field does not exist yet', () => {
    const ctx = buildDecisionContext({
      status: 'decided',
      outcome: 'Chose X',
      decidedAt: '2026-01-01T00:00:00.000Z',
      relationshipCount: 1,
      linkedMemoryCount: 1,
    });
    expect(ctx.unknown).toContain(
      'What actually happened as a result of this decision has not been recorded — Twin does not yet track post-decision outcomes.',
    );
  });

  it('a reversed decision does not demand a decision date the way an open one does', () => {
    const ctx = buildDecisionContext({
      status: 'reversed',
      outcome: null,
      decidedAt: null,
      relationshipCount: 0,
      linkedMemoryCount: 0,
    });
    expect(ctx.unknown).not.toContain('No decision date recorded — this decision is still open.');
    // A reversed decision is still expected to have an outcome recorded (what was reversed away from).
    expect(ctx.unknown).toContain('No chosen option/outcome has been recorded yet.');
  });

  it('hasEvidence is true if either relationships or linked memories exist, independently', () => {
    expect(
      buildDecisionContext({ status: 'open', outcome: null, decidedAt: null, relationshipCount: 1, linkedMemoryCount: 0 }).hasEvidence,
    ).toBe(true);
    expect(
      buildDecisionContext({ status: 'open', outcome: null, decidedAt: null, relationshipCount: 0, linkedMemoryCount: 1 }).hasEvidence,
    ).toBe(true);
    expect(
      buildDecisionContext({ status: 'open', outcome: null, decidedAt: null, relationshipCount: 0, linkedMemoryCount: 0 }).hasEvidence,
    ).toBe(false);
  });
});
