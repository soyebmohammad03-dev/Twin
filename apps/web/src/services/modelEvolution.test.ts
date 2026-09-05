import { describe, expect, it } from 'vitest';
import type { PersonalModelChangeDto } from '@twin/contracts';
import { groupEvolutionByDay, toEvolutionItem } from './modelEvolution';

function makeChange(overrides: Partial<PersonalModelChangeDto> = {}): PersonalModelChangeDto {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    factId: null,
    changeType: 'new_person',
    description: 'New Important People: Dr. Priya Anand',
    evidenceMemoryIds: [],
    createdAt: '2026-01-01T12:00:00.000Z',
    ...overrides,
  };
}

describe('toEvolutionItem', () => {
  it('preserves the backend description text verbatim, never rewriting it', () => {
    const change = makeChange({ description: 'New Active Projects: Project Nightingale' });
    const item = toEvolutionItem(change);
    expect(item.description).toBe('New Active Projects: Project Nightingale');
  });

  it('maps a known changeType to a real icon and short label', () => {
    const item = toEvolutionItem(makeChange({ changeType: 'fact_dismissed' }));
    expect(item.icon).toBe('visibility_off');
    expect(item.label).toBe('You dismissed this');
  });

  it('falls back to an honest generic label for an unrecognized changeType, never fabricating specifics', () => {
    const item = toEvolutionItem(makeChange({ changeType: 'some_future_change_type' }));
    expect(item.label).toBe('Model updated');
    expect(item.icon).toBe('auto_awesome');
  });

  it('carries the real factId through so the UI can link to real evidence, or null when there is none', () => {
    expect(toEvolutionItem(makeChange({ factId: 'fact-1' })).factId).toBe('fact-1');
    expect(toEvolutionItem(makeChange({ factId: null })).factId).toBeNull();
  });
});

describe('groupEvolutionByDay', () => {
  it('groups changes on the same calendar day together', () => {
    const changes = [
      makeChange({ id: 'a', createdAt: '2026-01-02T09:00:00.000Z' }),
      makeChange({ id: 'b', createdAt: '2026-01-02T15:00:00.000Z' }),
      makeChange({ id: 'c', createdAt: '2026-01-01T09:00:00.000Z' }),
    ];
    const groups = groupEvolutionByDay(changes);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.items).toHaveLength(2);
    expect(groups[1]!.items).toHaveLength(1);
  });

  it('returns an empty array for no history — an honest empty state, never fabricated evolution', () => {
    expect(groupEvolutionByDay([])).toEqual([]);
  });

  it('preserves the input (already reverse-chronological) order within and across groups', () => {
    const changes = [
      makeChange({ id: 'newest', createdAt: '2026-01-02T09:00:00.000Z' }),
      makeChange({ id: 'older', createdAt: '2026-01-01T09:00:00.000Z' }),
    ];
    const groups = groupEvolutionByDay(changes);
    expect(groups[0]!.items[0]!.id).toBe('newest');
    expect(groups[1]!.items[0]!.id).toBe('older');
  });
});
