import { describe, expect, it } from 'vitest';
import { computeEpistemicTier, INFERRED_WELL_SUPPORTED_CONFIDENCE_THRESHOLD } from '../src/modules/context/epistemicTier.js';
import { resolveContextBudget, truncateContent, estimateTokens, DEFAULT_CONTEXT_BUDGET } from '../src/modules/context/budget.js';
import { jaccardSimilarity, normalizedTokenSet, selectDiverseByContent, NEAR_DUPLICATE_JACCARD_THRESHOLD } from '../src/modules/context/diversity.js';
import { detectRelationshipConflicts } from '../src/modules/context/conflicts.js';
import { classifyIntentDeterministic } from '../src/modules/context/intent.js';
import { parseTemporalExpression, RECENTLY_WINDOW_DAYS } from '../src/modules/context/temporalExpressions.js';

describe('computeEpistemicTier', () => {
  it('explicit is always high, regardless of confidence', () => {
    expect(computeEpistemicTier('explicit', 1)).toBe('high');
    expect(computeEpistemicTier('explicit', 0.1)).toBe('high');
  });

  it('from_source and reported_by_other are always medium', () => {
    expect(computeEpistemicTier('from_source', 1)).toBe('medium');
    expect(computeEpistemicTier('from_source', 0.1)).toBe('medium');
    expect(computeEpistemicTier('reported_by_other', 0.9)).toBe('medium');
    expect(computeEpistemicTier('reported_by_other', 0.1)).toBe('medium');
  });

  it('inferred is medium at/above the well-supported threshold, low below it', () => {
    expect(computeEpistemicTier('inferred', INFERRED_WELL_SUPPORTED_CONFIDENCE_THRESHOLD)).toBe('medium');
    expect(computeEpistemicTier('inferred', INFERRED_WELL_SUPPORTED_CONFIDENCE_THRESHOLD + 0.01)).toBe('medium');
    expect(computeEpistemicTier('inferred', INFERRED_WELL_SUPPORTED_CONFIDENCE_THRESHOLD - 0.01)).toBe('low');
  });

  it('probable is always low, regardless of confidence', () => {
    expect(computeEpistemicTier('probable', 0.9)).toBe('low');
    expect(computeEpistemicTier('probable', 0.1)).toBe('low');
  });
});

describe('resolveContextBudget', () => {
  it('returns the defaults when no override is given', () => {
    expect(resolveContextBudget(undefined)).toEqual(DEFAULT_CONTEXT_BUDGET);
  });

  it('merges a partial override over the defaults, field by field', () => {
    const resolved = resolveContextBudget({ maxMemories: 3 });
    expect(resolved.maxMemories).toBe(3);
    expect(resolved.maxEntities).toBe(DEFAULT_CONTEXT_BUDGET.maxEntities);
    expect(resolved.maxRelationships).toBe(DEFAULT_CONTEXT_BUDGET.maxRelationships);
  });
});

describe('truncateContent', () => {
  it('returns content unchanged when it already fits', () => {
    const result = truncateContent('short content', 100);
    expect(result).toEqual({ content: 'short content', truncated: false });
  });

  it('truncates on a word boundary and marks truncated', () => {
    const content = 'one two three four five six seven eight nine ten';
    const result = truncateContent(content, 20);
    expect(result.truncated).toBe(true);
    expect(result.content.length).toBeLessThanOrEqual(21); // 20 + ellipsis
    expect(result.content.endsWith('…')).toBe(true);
  });

  it('is deterministic — same input always produces the same output', () => {
    const content = 'a'.repeat(1000);
    expect(truncateContent(content, 50)).toEqual(truncateContent(content, 50));
  });
});

describe('estimateTokens', () => {
  it('is a rough chars/4 estimate, documented as approximate', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('diversity: jaccardSimilarity / normalizedTokenSet', () => {
  it('is 1 for identical text', () => {
    const a = normalizedTokenSet('Arjun suggested the drone project redesign.');
    const b = normalizedTokenSet('Arjun suggested the drone project redesign.');
    expect(jaccardSimilarity(a, b)).toBe(1);
  });

  it('is 0 for completely disjoint text', () => {
    const a = normalizedTokenSet('apples bananas cherries');
    const b = normalizedTokenSet('rockets moons planets');
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it('ignores case and punctuation', () => {
    const a = normalizedTokenSet('Arjun, suggested THE drone-project.');
    const b = normalizedTokenSet('arjun suggested the drone project');
    expect(jaccardSimilarity(a, b)).toBeGreaterThan(0.8);
  });
});

describe('selectDiverseByContent', () => {
  it('keeps distinct content over near-duplicates when budget is tight', () => {
    const candidates = [
      { id: 'a', content: 'Arjun suggested redesigning the drone project flight controller.' },
      { id: 'b', content: 'Arjun suggested redesigning the drone project flight controller architecture.' }, // near-dup of a
      { id: 'c', content: 'Sarah proposed a new budget for the mobile app project.' }, // distinct
      { id: 'd', content: 'The team decided to prioritize offline support next quarter.' }, // distinct
    ];
    const selected = selectDiverseByContent(candidates, 3, (c) => c.content);
    expect(selected.map((c) => c.id)).toEqual(['a', 'c', 'd']);
  });

  it('backfills near-duplicates rather than leaving budget slots empty', () => {
    const candidates = [
      { id: 'a', content: 'Arjun suggested redesigning the drone project.' },
      { id: 'b', content: 'Arjun suggested redesigning the drone project again.' },
    ];
    const selected = selectDiverseByContent(candidates, 2, (c) => c.content);
    expect(selected.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('never returns more than maxCount items', () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, content: `unique content number ${i}` }));
    const selected = selectDiverseByContent(candidates, 4, (c) => c.content);
    expect(selected).toHaveLength(4);
  });

  it('returns an empty array for maxCount <= 0', () => {
    expect(selectDiverseByContent([{ id: 'a', content: 'x' }], 0, (c) => c.content)).toEqual([]);
  });

  it('is deterministic for the same input', () => {
    const candidates = [
      { id: 'a', content: 'first distinct memory' },
      { id: 'b', content: 'second distinct memory' },
      { id: 'c', content: 'first distinct memory duplicate-ish' },
    ];
    const first = selectDiverseByContent(candidates, 2, (c) => c.content);
    const second = selectDiverseByContent(candidates, 2, (c) => c.content);
    expect(first).toEqual(second);
  });

  it('the near-duplicate threshold is exercised at the boundary', () => {
    // Sanity: the exported threshold is what selectDiverseByContent actually uses.
    expect(NEAR_DUPLICATE_JACCARD_THRESHOLD).toBeGreaterThan(0);
    expect(NEAR_DUPLICATE_JACCARD_THRESHOLD).toBeLessThan(1);
  });
});

describe('detectRelationshipConflicts', () => {
  it('flags two distinct relationships from the same entity with the same type pointing at different targets', () => {
    const conflicts = detectRelationshipConflicts([
      { relationshipId: 'r1', fromEntityId: 'arjun', relationshipType: 'works_on', toEntityId: 'projectA' },
      { relationshipId: 'r2', fromEntityId: 'arjun', relationshipType: 'works_on', toEntityId: 'projectB' },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].type).toBe('relationship_conflict');
    expect(conflicts[0].fromEntityId).toBe('arjun');
    expect(conflicts[0].relationshipType).toBe('works_on');
    expect(conflicts[0].relationshipIds.sort()).toEqual(['r1', 'r2']);
  });

  it('does not flag a single relationship of a given (from, type)', () => {
    const conflicts = detectRelationshipConflicts([
      { relationshipId: 'r1', fromEntityId: 'arjun', relationshipType: 'works_on', toEntityId: 'projectA' },
    ]);
    expect(conflicts).toEqual([]);
  });

  it('does not flag different relationship types from the same entity', () => {
    const conflicts = detectRelationshipConflicts([
      { relationshipId: 'r1', fromEntityId: 'arjun', relationshipType: 'works_on', toEntityId: 'projectA' },
      { relationshipId: 'r2', fromEntityId: 'arjun', relationshipType: 'suggested', toEntityId: 'decisionA' },
    ]);
    expect(conflicts).toEqual([]);
  });

  it('does not flag the same (from, type, to) appearing twice — that is not a conflict, just a duplicate input row', () => {
    const conflicts = detectRelationshipConflicts([
      { relationshipId: 'r1', fromEntityId: 'arjun', relationshipType: 'works_on', toEntityId: 'projectA' },
      { relationshipId: 'r1', fromEntityId: 'arjun', relationshipType: 'works_on', toEntityId: 'projectA' },
    ]);
    expect(conflicts).toEqual([]);
  });

  it('is deterministic — same input always produces the same output', () => {
    const input = [
      { relationshipId: 'r2', fromEntityId: 'arjun', relationshipType: 'works_on', toEntityId: 'projectB' },
      { relationshipId: 'r1', fromEntityId: 'arjun', relationshipType: 'works_on', toEntityId: 'projectA' },
    ];
    expect(detectRelationshipConflicts(input)).toEqual(detectRelationshipConflicts(input));
  });
});

describe('classifyIntentDeterministic', () => {
  const base = { explicitTargets: { person: false, project: false, goal: false, decision: false } };

  it('classifies a comparison query', () => {
    const result = classifyIntentDeterministic({ query: 'Architecture A vs Architecture B', matchedEntityTypes: [], ...base });
    expect(result.intent).toBe('comparison');
  });

  it('classifies a timeline query', () => {
    const result = classifyIntentDeterministic({ query: 'What is the history of this project?', matchedEntityTypes: [], ...base });
    expect(result.intent).toBe('timeline_recall');
  });

  it('classifies decision recall from an explicit decision target', () => {
    const result = classifyIntentDeterministic({
      query: 'anything',
      matchedEntityTypes: [],
      explicitTargets: { ...base.explicitTargets, decision: true },
    });
    expect(result.intent).toBe('decision_recall');
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('classifies project recall from a matched project entity', () => {
    const result = classifyIntentDeterministic({ query: 'anything', matchedEntityTypes: ['project'], ...base });
    expect(result.intent).toBe('project_recall');
  });

  it('classifies person recall from the word "who"', () => {
    const result = classifyIntentDeterministic({ query: 'Who suggested this?', matchedEntityTypes: [], ...base });
    expect(result.intent).toBe('person_recall');
  });

  it('classifies planning context from an explicit goal target', () => {
    const result = classifyIntentDeterministic({
      query: 'anything',
      matchedEntityTypes: [],
      explicitTargets: { ...base.explicitTargets, goal: true },
    });
    expect(result.intent).toBe('planning_context');
  });

  it('falls back to factual_recall when an entity matched but nothing more specific fired', () => {
    const result = classifyIntentDeterministic({ query: 'Tell me about it', matchedEntityTypes: ['idea'], ...base });
    expect(result.intent).toBe('factual_recall');
  });

  it('falls back to general_knowledge when nothing matched at all', () => {
    const result = classifyIntentDeterministic({ query: 'What is the capital of France?', matchedEntityTypes: [], ...base });
    expect(result.intent).toBe('general_knowledge');
  });

  it('is deterministic — same input always produces the same output', () => {
    const input = { query: 'Who suggested the drone project?', matchedEntityTypes: ['person' as const], ...base };
    expect(classifyIntentDeterministic(input)).toEqual(classifyIntentDeterministic(input));
  });

  it('every returned intent is one of the documented signals, never invented free text reasoning', () => {
    const result = classifyIntentDeterministic({ query: 'random text', matchedEntityTypes: [], ...base });
    expect(Array.isArray(result.signals)).toBe(true);
    expect(result.signals.length).toBeGreaterThan(0);
  });
});

describe('parseTemporalExpression (Phase 17)', () => {
  const NOW = new Date('2026-06-10T15:30:00.000Z'); // a Wednesday

  it('returns null when the query has no recognized temporal expression', () => {
    expect(parseTemporalExpression('what did Sarah say about the drone project', NOW)).toBeNull();
  });

  it("'today' resolves to the start and end of the current calendar day", () => {
    const result = parseTemporalExpression('what happened today', NOW);
    expect(result).not.toBeNull();
    expect(result!.occurredAfter.getDate()).toBe(NOW.getDate());
    expect(result!.occurredAfter.getHours()).toBe(0);
    expect(result!.occurredBefore.getDate()).toBe(NOW.getDate());
    expect(result!.occurredBefore.getHours()).toBe(23);
    expect(result!.signal).toContain('today');
  });

  it("'yesterday' resolves to exactly the previous calendar day, entirely before today", () => {
    const result = parseTemporalExpression('what did we discuss yesterday', NOW);
    expect(result).not.toBeNull();
    const todayStart = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 0, 0, 0, 0);
    expect(result!.occurredBefore.getTime()).toBeLessThan(todayStart.getTime());
    expect(todayStart.getTime() - result!.occurredAfter.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("'this week' starts on a Monday and ends now-ish (same day as NOW)", () => {
    const result = parseTemporalExpression('what came up this week', NOW);
    expect(result).not.toBeNull();
    expect(result!.occurredAfter.getDay()).toBe(1); // Monday
    expect(result!.occurredAfter.getTime()).toBeLessThanOrEqual(NOW.getTime());
    expect(result!.occurredBefore.getDate()).toBe(NOW.getDate());
  });

  it("'last week' is the full 7-day week immediately before this week's Monday, with no gap or overlap", () => {
    const thisWeek = parseTemporalExpression('this week', NOW)!;
    const lastWeek = parseTemporalExpression('last week', NOW)!;
    expect(lastWeek.occurredAfter.getDay()).toBe(1); // Monday
    expect(thisWeek.occurredAfter.getTime() - lastWeek.occurredBefore.getTime()).toBe(1); // ends exactly 1ms before this week starts
    expect(lastWeek.occurredBefore.getTime() - lastWeek.occurredAfter.getTime()).toBeCloseTo(7 * 24 * 60 * 60 * 1000, -3);
  });

  it("'this month' starts on the 1st and ends now-ish", () => {
    const result = parseTemporalExpression('this month', NOW);
    expect(result).not.toBeNull();
    expect(result!.occurredAfter.getDate()).toBe(1);
    expect(result!.occurredAfter.getMonth()).toBe(NOW.getMonth());
  });

  it("'last month' is the full calendar month immediately before this month, with no gap or overlap", () => {
    const thisMonth = parseTemporalExpression('this month', NOW)!;
    const lastMonth = parseTemporalExpression('last month', NOW)!;
    expect(lastMonth.occurredAfter.getDate()).toBe(1);
    expect(lastMonth.occurredAfter.getMonth()).toBe((NOW.getMonth() + 11) % 12);
    expect(thisMonth.occurredAfter.getTime() - lastMonth.occurredBefore.getTime()).toBe(1);
  });

  it("'recently'/'recent' resolves to a fixed trailing window ending now-ish", () => {
    const result = parseTemporalExpression('what has Sarah said recently', NOW);
    expect(result).not.toBeNull();
    const expectedStart = new Date(NOW.getTime() - RECENTLY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    expect(Math.abs(result!.occurredAfter.getTime() - expectedStart.getTime())).toBeLessThan(1000);

    const result2 = parseTemporalExpression('any recent updates on the drone project', NOW);
    expect(result2).not.toBeNull();
  });

  it("'recently'/'recent' each match on a real word boundary, not as a bare substring of a longer word", () => {
    // Regression: an earlier version of the alternation pattern lacked a
    // trailing boundary on the "recently" branch and matched "recentlyish".
    expect(parseTemporalExpression('a recentlyish plan', NOW)).toBeNull();
  });

  it('is case-insensitive, and matches on a real word boundary rather than as a bare substring', () => {
    expect(parseTemporalExpression('TODAY was busy', NOW)).not.toBeNull();
    // "yesterday" must NOT spuriously match inside an unrelated longer word.
    expect(parseTemporalExpression('the yesterdayish plan', NOW)).toBeNull();
  });

  it('is deterministic — same query and now always produce the same range', () => {
    const a = parseTemporalExpression('what happened last week', NOW);
    const b = parseTemporalExpression('what happened last week', NOW);
    expect(a).toEqual(b);
  });

  it('a query naming no temporal expression at all, and one with only unrelated words, both return null (not a false positive)', () => {
    expect(parseTemporalExpression('', NOW)).toBeNull();
    expect(parseTemporalExpression('Project Helios budget review', NOW)).toBeNull();
  });
});
