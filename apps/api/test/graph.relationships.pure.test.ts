import { describe, expect, it } from 'vitest';
import { isStrongerEvidence } from '../src/modules/graph/relationships.service.js';

/** Pure, no-DB tests for the epistemic-strength rollup comparison used by upsertRelationshipWithEvidence. */
describe('isStrongerEvidence', () => {
  it('explicit beats inferred, regardless of confidence', () => {
    expect(
      isStrongerEvidence(
        { epistemicStatus: 'inferred', confidence: 0.95 },
        { epistemicStatus: 'explicit', confidence: 0.5 },
      ),
    ).toBe(true);
  });

  it('a lower-ranked status is never considered stronger, even with higher confidence', () => {
    expect(
      isStrongerEvidence(
        { epistemicStatus: 'explicit', confidence: 0.6 },
        { epistemicStatus: 'probable', confidence: 0.99 },
      ),
    ).toBe(false);
  });

  it('ties on epistemic status are broken by confidence', () => {
    expect(
      isStrongerEvidence(
        { epistemicStatus: 'inferred', confidence: 0.5 },
        { epistemicStatus: 'inferred', confidence: 0.7 },
      ),
    ).toBe(true);
    expect(
      isStrongerEvidence(
        { epistemicStatus: 'inferred', confidence: 0.7 },
        { epistemicStatus: 'inferred', confidence: 0.5 },
      ),
    ).toBe(false);
  });

  it('an exact tie (same status, same confidence) is not an upgrade', () => {
    expect(
      isStrongerEvidence(
        { epistemicStatus: 'reported_by_other', confidence: 0.7 },
        { epistemicStatus: 'reported_by_other', confidence: 0.7 },
      ),
    ).toBe(false);
  });

  it('follows the full documented rank order: explicit > from_source > reported_by_other > inferred > probable', () => {
    const order = ['probable', 'inferred', 'reported_by_other', 'from_source', 'explicit'] as const;
    for (let i = 0; i < order.length - 1; i++) {
      const weaker = { epistemicStatus: order[i], confidence: 0.9 };
      const stronger = { epistemicStatus: order[i + 1], confidence: 0.1 };
      expect(isStrongerEvidence(weaker, stronger)).toBe(true);
    }
  });
});
