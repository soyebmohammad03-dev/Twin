import { describe, expect, it } from 'vitest';
import type { InsightDto } from '@twin/contracts';
import { selectExplorationInsights } from './exploreInsight';

function makeInsight(overrides: Partial<InsightDto> = {}): InsightDto {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    insightType: 'recurring_topic',
    subjectKey: 'topic:nightingale',
    statusClass: 'observed',
    temporalState: 'stable',
    title: 'Project Nightingale comes up often',
    description: 'Mentioned 5 times this month.',
    confidence: 0.8,
    subjectEntityId: null,
    subjectEntityName: null,
    subjectEntityType: null,
    firstObservedAt: '2026-01-01T00:00:00.000Z',
    lastObservedAt: '2026-01-05T00:00:00.000Z',
    observationCount: 5,
    dismissedAt: null,
    supersededByInsightId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-05T00:00:00.000Z',
    ...overrides,
  };
}

describe('selectExplorationInsights', () => {
  it('returns an empty array for an empty vault — an honest empty state, never fabricated patterns', () => {
    expect(selectExplorationInsights([])).toEqual([]);
  });

  it('excludes superseded insights — a pattern Twin no longer considers active should not headline exploration', () => {
    const active = makeInsight({ id: 'a', temporalState: 'stable' });
    const superseded = makeInsight({ id: 'b', temporalState: 'superseded' });
    expect(selectExplorationInsights([superseded, active])).toEqual([active]);
  });

  it('caps the result at `count`, defaulting to 3', () => {
    const insights = Array.from({ length: 5 }, (_, i) => makeInsight({ id: `i${i}` }));
    expect(selectExplorationInsights(insights)).toHaveLength(3);
    expect(selectExplorationInsights(insights, 2)).toHaveLength(2);
  });

  it('preserves the input order (the caller — GET /insights — already orders by confidence/recency)', () => {
    const first = makeInsight({ id: 'first' });
    const second = makeInsight({ id: 'second' });
    expect(selectExplorationInsights([first, second])).toEqual([first, second]);
  });

  it('returns every insight when there are fewer than `count`, never padding with fabricated entries', () => {
    const insights = [makeInsight({ id: 'only' })];
    expect(selectExplorationInsights(insights, 3)).toEqual(insights);
  });
});
