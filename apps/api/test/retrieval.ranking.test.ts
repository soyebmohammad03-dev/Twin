import { describe, expect, it } from 'vitest';
import {
  computeRankScore,
  computeRecencyScore,
  normalizeImportance,
  DEFAULT_RANKING_WEIGHTS,
  RECENCY_HALF_LIFE_DAYS,
  ENTITY_MATCH_DIRECT,
  ENTITY_MATCH_EXPANDED,
  ENTITY_MATCH_NONE,
  type RankingSignals,
} from '../src/modules/retrieval/ranking.js';
import { buildMatchReasons } from '../src/modules/retrieval/retrieval.service.js';

const baseSignals: RankingSignals = {
  semanticSimilarity: 0,
  lexicalScore: 0,
  entityMatchScore: 0,
  recencyScore: 0,
  importanceScore: 0,
  confidenceScore: 0,
};

describe('computeRankScore', () => {
  it('is pure — identical input always produces identical output', () => {
    const signals: RankingSignals = { ...baseSignals, semanticSimilarity: 0.7, lexicalScore: 0.2 };
    expect(computeRankScore(signals)).toBe(computeRankScore(signals));
  });

  it('scores all-zero signals as exactly 0', () => {
    expect(computeRankScore(baseSignals)).toBe(0);
  });

  it('scores all-1.0 signals as the sum of the weights (≈1.0 for the default weights)', () => {
    const allOnes: RankingSignals = {
      semanticSimilarity: 1,
      lexicalScore: 1,
      entityMatchScore: 1,
      recencyScore: 1,
      importanceScore: 1,
      confidenceScore: 1,
    };
    const weightSum = Object.values(DEFAULT_RANKING_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(computeRankScore(allOnes)).toBeCloseTo(weightSum, 10);
  });

  it('clamps out-of-range signal values instead of letting them distort the score', () => {
    const overOne: RankingSignals = { ...baseSignals, semanticSimilarity: 5 };
    const clampedToOne: RankingSignals = { ...baseSignals, semanticSimilarity: 1 };
    expect(computeRankScore(overOne)).toBe(computeRankScore(clampedToOne));

    const negative: RankingSignals = { ...baseSignals, importanceScore: -3 };
    expect(computeRankScore(negative)).toBe(0);
  });

  it('treats NaN as 0 rather than propagating NaN through the score', () => {
    const withNaN: RankingSignals = { ...baseSignals, lexicalScore: Number.NaN };
    expect(computeRankScore(withNaN)).toBe(0);
  });

  it('a higher semantic similarity produces a strictly higher score, all else equal', () => {
    const low = computeRankScore({ ...baseSignals, semanticSimilarity: 0.2 });
    const high = computeRankScore({ ...baseSignals, semanticSimilarity: 0.9 });
    expect(high).toBeGreaterThan(low);
  });

  it('a direct entity match outranks an expanded entity match, all else equal', () => {
    const direct = computeRankScore({ ...baseSignals, entityMatchScore: ENTITY_MATCH_DIRECT });
    const expanded = computeRankScore({ ...baseSignals, entityMatchScore: ENTITY_MATCH_EXPANDED });
    const none = computeRankScore({ ...baseSignals, entityMatchScore: ENTITY_MATCH_NONE });
    expect(direct).toBeGreaterThan(expanded);
    expect(expanded).toBeGreaterThan(none);
  });

  it('accepts custom weights instead of the module default', () => {
    const signals: RankingSignals = { ...baseSignals, recencyScore: 1 };
    const zeroedOut = computeRankScore(signals, {
      semanticSimilarity: 0,
      lexicalScore: 0,
      entityMatchScore: 0,
      recencyScore: 0,
      importanceScore: 0,
      confidenceScore: 0,
    });
    expect(zeroedOut).toBe(0);

    const recencyOnly = computeRankScore(signals, {
      semanticSimilarity: 0,
      lexicalScore: 0,
      entityMatchScore: 0,
      recencyScore: 1,
      importanceScore: 0,
      confidenceScore: 0,
    });
    expect(recencyOnly).toBe(1);
  });
});

describe('computeRecencyScore', () => {
  it('scores age-0 (just happened) as exactly 1.0', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(computeRecencyScore(now, now)).toBe(1);
  });

  it('scores exactly one half-life old as 0.5', () => {
    const now = new Date('2026-01-31T00:00:00Z');
    const then = new Date(now.getTime() - RECENCY_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000);
    expect(computeRecencyScore(then, now)).toBeCloseTo(0.5, 6);
  });

  it('never goes negative or above 1 even for future-dated or very old memories', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const future = new Date('2027-01-01T00:00:00Z');
    const ancient = new Date('2000-01-01T00:00:00Z');
    expect(computeRecencyScore(future, now)).toBeLessThanOrEqual(1);
    expect(computeRecencyScore(future, now)).toBeGreaterThanOrEqual(0);
    expect(computeRecencyScore(ancient, now)).toBeGreaterThan(0);
    expect(computeRecencyScore(ancient, now)).toBeLessThan(0.01);
  });

  it('a more recent date always scores higher than an older one', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const recent = new Date('2026-05-25T00:00:00Z');
    const old = new Date('2025-01-01T00:00:00Z');
    expect(computeRecencyScore(recent, now)).toBeGreaterThan(computeRecencyScore(old, now));
  });
});

describe('normalizeImportance', () => {
  it('maps the full 1-5 range to 0-1 linearly', () => {
    expect(normalizeImportance(1)).toBe(0);
    expect(normalizeImportance(5)).toBe(1);
    expect(normalizeImportance(3)).toBeCloseTo(0.5, 6);
  });
});

describe('buildMatchReasons', () => {
  it('does not claim a lexical match from ts_rank floating-point noise — regression for a live Gemini search finding', () => {
    // Discovered live: Postgres's ts_rank returns a vanishingly small
    // nonzero value (observed: 1e-20) even for content with no real
    // textual match to the query, which a naive `> 0` check would
    // wrongly report as "matches your query's exact wording".
    const reasons = buildMatchReasons({ ...baseSignals, semanticSimilarity: 0.68, lexicalScore: 1e-20 }, []);
    expect(reasons.some((r) => r.includes('exact wording'))).toBe(false);
    expect(reasons.some((r) => r.includes('semantically similar'))).toBe(true);
  });

  it('does claim a lexical match for a genuine, meaningfully-sized ts_rank score', () => {
    const reasons = buildMatchReasons({ ...baseSignals, lexicalScore: 0.05 }, []);
    expect(reasons.some((r) => r.includes('exact wording'))).toBe(true);
  });

  it('falls back to a generic reason when no signal clears its threshold', () => {
    const reasons = buildMatchReasons(baseSignals, []);
    expect(reasons).toEqual(['weak overall match on the available signals']);
  });
});
