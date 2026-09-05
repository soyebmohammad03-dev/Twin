/**
 * Phase 23 — pure, no-network derivations over real Personal Model /
 * entity data (PersonalModelResponse, EntityDto), for ProfileView's
 * "What Twin Knows" and "Model Calibration" sections. Mirrors
 * graphMapper.ts / ingestionActivity.ts's role: no fetch, no React,
 * every number traces back to a real row — nothing here invents a
 * percentage, a status word, or a count.
 */

import type { EntityDto, PersonalModelFactDto } from '@twin/contracts';

export interface EntityCounts {
  total: number;
  people: number;
  goals: number;
}

export function countEntities(entities: EntityDto[]): EntityCounts {
  return {
    total: entities.length,
    people: entities.filter((e) => e.entityType === 'person').length,
    goals: entities.filter((e) => e.entityType === 'goal').length,
  };
}

export interface EpistemicBreakdown {
  totalCount: number;
  explicitCount: number;
  inferredCount: number;
  uncertainCount: number;
  /** Percentages of totalCount, rounded to whole numbers and adjusted so they always sum to exactly 100 (never 99/101 from independent rounding) — never shown at all when totalCount is 0. */
  explicitPct: number;
  inferredPct: number;
  uncertainPct: number;
}

/**
 * Buckets real, non-dismissed Personal Model facts into three groups
 * for the Model Calibration bar:
 *
 *  - uncertain: any fact already in the server-computed
 *    `uncertainFactIds` set (PersonalModelResponse) — the SAME
 *    "Needs Confirmation" definition PersonalModelSection already
 *    shows, reused here rather than re-derived from confidence
 *    independently (which could disagree with the section right below it).
 *  - explicit: not uncertain, and epistemicStatus is 'explicit' or
 *    'from_source' (a direct or sourced statement).
 *  - inferred: everything else not uncertain (Twin-derived: 'inferred',
 *    'probable', or third-party 'reported_by_other').
 *
 * Every fact lands in exactly one bucket, so the three counts always
 * sum to totalCount.
 */
export function computeEpistemicBreakdown(facts: PersonalModelFactDto[], uncertainFactIds: string[]): EpistemicBreakdown {
  const uncertainSet = new Set(uncertainFactIds);
  let explicitCount = 0;
  let inferredCount = 0;
  let uncertainCount = 0;

  for (const fact of facts) {
    if (uncertainSet.has(fact.id)) {
      uncertainCount++;
    } else if (fact.epistemicStatus === 'explicit' || fact.epistemicStatus === 'from_source') {
      explicitCount++;
    } else {
      inferredCount++;
    }
  }

  const totalCount = facts.length;
  const [explicitPct, inferredPct, uncertainPct] = distributePercentages(
    [explicitCount, inferredCount, uncertainCount],
    totalCount,
  );

  return { totalCount, explicitCount, inferredCount, uncertainCount, explicitPct, inferredPct, uncertainPct };
}

/** Rounds each count to a percentage of total, then corrects the largest share so the three always sum to exactly 100 — avoids a bar that visually reads as under/over 100% purely from independent rounding. Returns [0,0,0] when total is 0. */
function distributePercentages(counts: number[], total: number): number[] {
  if (total === 0) return counts.map(() => 0);
  const raw = counts.map((c) => (c / total) * 100);
  const rounded = raw.map((v) => Math.round(v));
  const drift = 100 - rounded.reduce((sum, v) => sum + v, 0);
  if (drift !== 0) {
    const largestIndex = rounded.indexOf(Math.max(...rounded));
    rounded[largestIndex] = rounded[largestIndex]! + drift;
  }
  return rounded;
}
