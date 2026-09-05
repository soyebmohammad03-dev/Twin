import { describe, expect, it } from 'vitest';
import type { EntityDto, PersonalModelFactDto } from '@twin/contracts';
import { computeEpistemicBreakdown, countEntities } from './personalModelStats';

function makeEntity(overrides: Partial<EntityDto> = {}): EntityDto {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    entityType: 'project',
    name: 'Project Nightingale',
    description: null,
    metadata: {},
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeFact(overrides: Partial<PersonalModelFactDto> = {}): PersonalModelFactDto {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    category: 'preferences',
    subjectKey: 'pref:dark-mode',
    subjectEntityId: null,
    subjectEntityName: null,
    subjectEntityType: null,
    factText: 'You prefer dark mode.',
    epistemicStatus: 'explicit',
    confidence: 0.9,
    stability: 'stable',
    temporalState: 'current',
    firstObservedAt: '2026-01-01T00:00:00.000Z',
    lastObservedAt: '2026-01-01T00:00:00.000Z',
    observationCount: 1,
    dismissedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('countEntities', () => {
  it('counts real entities by type, never fabricating a number', () => {
    const entities = [
      makeEntity({ id: 'a', entityType: 'project' }),
      makeEntity({ id: 'b', entityType: 'person' }),
      makeEntity({ id: 'c', entityType: 'person' }),
      makeEntity({ id: 'd', entityType: 'goal' }),
    ];
    expect(countEntities(entities)).toEqual({ total: 4, people: 2, goals: 1 });
  });

  it('returns all zeros for an empty vault — an honest empty state, not fabricated counts', () => {
    expect(countEntities([])).toEqual({ total: 0, people: 0, goals: 0 });
  });
});

describe('computeEpistemicBreakdown', () => {
  it('buckets explicit/from_source facts as explicit when not flagged uncertain', () => {
    const facts = [makeFact({ id: 'a', epistemicStatus: 'explicit' }), makeFact({ id: 'b', epistemicStatus: 'from_source' })];
    const result = computeEpistemicBreakdown(facts, []);
    expect(result.explicitCount).toBe(2);
    expect(result.inferredCount).toBe(0);
    expect(result.uncertainCount).toBe(0);
  });

  it('buckets inferred/probable/reported_by_other facts as inferred when not flagged uncertain', () => {
    const facts = [
      makeFact({ id: 'a', epistemicStatus: 'inferred' }),
      makeFact({ id: 'b', epistemicStatus: 'probable' }),
      makeFact({ id: 'c', epistemicStatus: 'reported_by_other' }),
    ];
    const result = computeEpistemicBreakdown(facts, []);
    expect(result.inferredCount).toBe(3);
    expect(result.explicitCount).toBe(0);
  });

  it('a fact flagged in uncertainFactIds always counts as uncertain, regardless of its epistemicStatus', () => {
    const facts = [makeFact({ id: 'a', epistemicStatus: 'explicit' })];
    const result = computeEpistemicBreakdown(facts, ['a']);
    expect(result.uncertainCount).toBe(1);
    expect(result.explicitCount).toBe(0);
  });

  it('every fact lands in exactly one bucket — counts always sum to the total', () => {
    const facts = [
      makeFact({ id: 'a', epistemicStatus: 'explicit' }),
      makeFact({ id: 'b', epistemicStatus: 'inferred' }),
      makeFact({ id: 'c', epistemicStatus: 'probable' }),
    ];
    const result = computeEpistemicBreakdown(facts, ['c']);
    expect(result.explicitCount + result.inferredCount + result.uncertainCount).toBe(3);
  });

  it('returns all zeros for an empty model — an honest empty state, never a fabricated distribution', () => {
    const result = computeEpistemicBreakdown([], []);
    expect(result).toEqual({
      totalCount: 0,
      explicitCount: 0,
      inferredCount: 0,
      uncertainCount: 0,
      explicitPct: 0,
      inferredPct: 0,
      uncertainPct: 0,
    });
  });

  it('percentages always sum to exactly 100 when there is at least one fact, despite rounding', () => {
    // 1 of 3 facts per bucket -> 33.33% each independently, which would round to 99 without correction.
    const facts = [
      makeFact({ id: 'a', epistemicStatus: 'explicit' }),
      makeFact({ id: 'b', epistemicStatus: 'inferred' }),
      makeFact({ id: 'c', epistemicStatus: 'reported_by_other' }),
    ];
    const result = computeEpistemicBreakdown(facts, ['c']);
    expect(result.explicitPct + result.inferredPct + result.uncertainPct).toBe(100);
  });

  it('a single-bucket model reports 100% for that bucket, not a fabricated split', () => {
    const facts = [makeFact({ id: 'a', epistemicStatus: 'explicit' }), makeFact({ id: 'b', epistemicStatus: 'from_source' })];
    const result = computeEpistemicBreakdown(facts, []);
    expect(result.explicitPct).toBe(100);
    expect(result.inferredPct).toBe(0);
    expect(result.uncertainPct).toBe(0);
  });
});
