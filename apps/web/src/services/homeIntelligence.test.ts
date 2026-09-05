import { describe, expect, it } from 'vitest';
import type { PersonalModelChangeDto, PersonalModelFactDto } from '@twin/contracts';
import type { MemoryItem } from '../types';
import {
  countMemoriesToday,
  selectContinuationMemory,
  selectFocusFact,
  selectRecentDistinctChanges,
  timeOfDay,
} from './homeIntelligence';

function makeChange(overrides: Partial<PersonalModelChangeDto>): PersonalModelChangeDto {
  return {
    id: 'change-1',
    factId: null,
    changeType: 'new_goal',
    description: 'New goal: something.',
    evidenceMemoryIds: [],
    createdAt: '2026-09-05T00:00:00.000Z',
    ...overrides,
  };
}

function makeFact(overrides: Partial<PersonalModelFactDto>): PersonalModelFactDto {
  return {
    id: 'fact-1',
    category: 'goals',
    subjectKey: 'subject',
    subjectEntityId: null,
    subjectEntityName: null,
    subjectEntityType: null,
    factText: 'You appear to be tracking a goal.',
    epistemicStatus: 'inferred',
    confidence: 0.8,
    stability: 'stable',
    temporalState: 'current',
    firstObservedAt: '2026-09-01T00:00:00.000Z',
    lastObservedAt: '2026-09-01T00:00:00.000Z',
    observationCount: 1,
    dismissedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeMemory(overrides: Partial<MemoryItem>): MemoryItem {
  return {
    id: 'mem-1',
    category: 'ideas',
    title: 'A thought',
    description: 'Some description',
    date: 'Sep 5, 2026',
    occurredAtIso: '2026-09-05T10:00:00.000Z',
    source: 'Manual Entry',
    sourceType: 'manual',
    explicit: true,
    ...overrides,
  };
}

describe('selectFocusFact', () => {
  it('returns null when there are no facts at all', () => {
    expect(selectFocusFact([])).toBeNull();
  });

  it('returns null when only ineligible categories (e.g. important_people) have facts', () => {
    const facts = [makeFact({ id: 'f1', category: 'important_people' })];
    expect(selectFocusFact(facts)).toBeNull();
  });

  it('prefers current_priorities over active_projects, goals, and decisions', () => {
    const priority = makeFact({ id: 'priority', category: 'current_priorities' });
    const project = makeFact({ id: 'project', category: 'active_projects' });
    const goal = makeFact({ id: 'goal', category: 'goals' });
    const decision = makeFact({ id: 'decision', category: 'decisions' });
    expect(selectFocusFact([goal, decision, project, priority])?.id).toBe('priority');
  });

  it('falls back to active_projects when there are no current_priorities', () => {
    const project = makeFact({ id: 'project', category: 'active_projects' });
    const goal = makeFact({ id: 'goal', category: 'goals' });
    expect(selectFocusFact([goal, project])?.id).toBe('project');
  });

  it('falls back to goals when there are no priorities or projects', () => {
    const goal = makeFact({ id: 'goal', category: 'goals' });
    const decision = makeFact({ id: 'decision', category: 'decisions' });
    expect(selectFocusFact([decision, goal])?.id).toBe('goal');
  });

  it('breaks ties within a category by most-recently-observed', () => {
    const older = makeFact({ id: 'older', category: 'goals', lastObservedAt: '2026-09-01T00:00:00.000Z' });
    const newer = makeFact({ id: 'newer', category: 'goals', lastObservedAt: '2026-09-04T00:00:00.000Z' });
    expect(selectFocusFact([older, newer])?.id).toBe('newer');
  });
});

describe('selectContinuationMemory', () => {
  it('returns null for an empty memory list', () => {
    expect(selectContinuationMemory([])).toBeNull();
  });

  it('returns the first (already most-recent) memory unchanged', () => {
    const first = makeMemory({ id: 'mem-a' });
    const second = makeMemory({ id: 'mem-b' });
    expect(selectContinuationMemory([first, second])?.id).toBe('mem-a');
  });
});

describe('countMemoriesToday', () => {
  // Built from local-time components (not UTC 'Z' literals) so this test's
  // notion of "today" matches the function's local-calendar-day semantics
  // regardless of which timezone the test runner is in.
  const now = new Date(2026, 8, 5, 20, 0);

  it('returns 0 for an empty memory list', () => {
    expect(countMemoriesToday([], now)).toBe(0);
  });

  it('counts only memories occurring on the same calendar day as now', () => {
    const today = makeMemory({ id: 'today', occurredAtIso: new Date(2026, 8, 5, 2, 0).toISOString() });
    const yesterday = makeMemory({ id: 'yesterday', occurredAtIso: new Date(2026, 8, 4, 23, 0).toISOString() });
    expect(countMemoriesToday([today, yesterday], now)).toBe(1);
  });

  it('counts multiple memories from today', () => {
    const a = makeMemory({ id: 'a', occurredAtIso: new Date(2026, 8, 5, 1, 0).toISOString() });
    const b = makeMemory({ id: 'b', occurredAtIso: new Date(2026, 8, 5, 18, 0).toISOString() });
    expect(countMemoriesToday([a, b], now)).toBe(2);
  });
});

describe('timeOfDay', () => {
  it('returns morning before noon', () => {
    expect(timeOfDay(new Date('2026-09-05T08:00:00'))).toBe('morning');
  });

  it('returns afternoon between noon and 6pm', () => {
    expect(timeOfDay(new Date('2026-09-05T14:00:00'))).toBe('afternoon');
  });

  it('returns evening from 6pm onward', () => {
    expect(timeOfDay(new Date('2026-09-05T20:00:00'))).toBe('evening');
  });

  it('treats exactly noon as afternoon and exactly 6pm as evening (boundary check)', () => {
    expect(timeOfDay(new Date('2026-09-05T12:00:00'))).toBe('afternoon');
    expect(timeOfDay(new Date('2026-09-05T18:00:00'))).toBe('evening');
  });
});

describe('selectRecentDistinctChanges', () => {
  it('returns an empty array for an empty change list', () => {
    expect(selectRecentDistinctChanges([], 4)).toEqual([]);
  });

  it('returns all changes unchanged when none are consecutive duplicates and total is under the limit', () => {
    const a = makeChange({ id: 'a', description: 'New goal: A.' });
    const b = makeChange({ id: 'b', description: 'New goal: B.' });
    expect(selectRecentDistinctChanges([a, b], 4).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('collapses consecutive duplicate descriptions, keeping only the first (most recent)', () => {
    const first = makeChange({ id: 'first', description: 'New current priorities: X.' });
    const dupe1 = makeChange({ id: 'dupe1', description: 'New current priorities: X.' });
    const dupe2 = makeChange({ id: 'dupe2', description: 'New current priorities: X.' });
    const other = makeChange({ id: 'other', description: 'New goal: Y.' });
    expect(selectRecentDistinctChanges([first, dupe1, dupe2, other], 4).map((c) => c.id)).toEqual(['first', 'other']);
  });

  it('does not collapse non-consecutive repeats of the same description', () => {
    const a = makeChange({ id: 'a', description: 'New goal: X.' });
    const b = makeChange({ id: 'b', description: 'New goal: Y.' });
    const c = makeChange({ id: 'c', description: 'New goal: X.' });
    expect(selectRecentDistinctChanges([a, b, c], 4).map((change) => change.id)).toEqual(['a', 'b', 'c']);
  });

  it('stops at limit distinct entries without reaching further into history', () => {
    const changes = [
      makeChange({ id: '1', description: 'One' }),
      makeChange({ id: '2', description: 'Two' }),
      makeChange({ id: '3', description: 'Three' }),
      makeChange({ id: '4', description: 'Four' }),
    ];
    expect(selectRecentDistinctChanges(changes, 2).map((c) => c.id)).toEqual(['1', '2']);
  });
});
