/**
 * Item 5's diversity requirement: "avoid returning ten nearly identical
 * memories when five different pieces of evidence would provide better
 * context." Pure, DB-free, deterministic — takes an already
 * relevance-ranked list and a way to read each item's text, and
 * returns at most `maxCount` items, preferring non-near-duplicate
 * content over blindly taking the top N.
 *
 * Similarity is Jaccard over normalized word sets — no embeddings
 * needed at selection time (this runs after ranking, on whatever
 * memories are already candidates), simple to reason about, and cheap
 * to unit test without a database. The 0.6 threshold is an initial,
 * documented heuristic (same spirit as ranking.ts's weights) — not
 * tuned against real duplicate pairs.
 */

export const NEAR_DUPLICATE_JACCARD_THRESHOLD = 0.6;

const WORD_PATTERN = /[a-z0-9]+/g;

export function normalizedTokenSet(text: string): Set<string> {
  const matches = text.toLowerCase().match(WORD_PATTERN);
  return new Set(matches ?? []);
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * `candidates` must already be sorted by relevance (best first) — this
 * function only decides what to keep, never re-ranks. Two-pass greedy:
 * first pass keeps the best-ranked item of each near-duplicate cluster,
 * skipping later near-duplicates; a second pass backfills skipped items
 * (still in their original relevance order) only if the budget wasn't
 * filled by distinct content — never leaving a slot empty when more
 * genuinely-not-yet-included evidence exists.
 */
export function selectDiverseByContent<T>(candidates: T[], maxCount: number, getContent: (item: T) => string): T[] {
  if (maxCount <= 0) return [];

  const selected: T[] = [];
  const selectedTokenSets: Set<string>[] = [];
  const skipped: T[] = [];

  for (const candidate of candidates) {
    if (selected.length >= maxCount) {
      skipped.push(candidate);
      continue;
    }
    const tokens = normalizedTokenSet(getContent(candidate));
    const isNearDuplicate = selectedTokenSets.some((s) => jaccardSimilarity(s, tokens) >= NEAR_DUPLICATE_JACCARD_THRESHOLD);
    if (isNearDuplicate) {
      skipped.push(candidate);
      continue;
    }
    selected.push(candidate);
    selectedTokenSets.push(tokens);
  }

  for (const candidate of skipped) {
    if (selected.length >= maxCount) break;
    selected.push(candidate);
  }

  return selected;
}
