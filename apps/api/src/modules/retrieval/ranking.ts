/**
 * The ranking function behind hybrid retrieval — one place where every
 * signal that influences a memory's rank is combined, instead of ad
 * hoc weighting scattered across retrieval.service.ts's SQL and
 * post-processing. Pure and DB-free by design: given a signal bundle,
 * it always returns the same score, which is what makes it directly
 * unit-testable (see test/retrieval.ranking.test.ts) without a
 * database, an embedding provider, or any other I/O.
 *
 * The weights below are an initial, hand-picked heuristic — NOT the
 * result of any offline evaluation, learned model, or A/B test. They
 * exist to produce a reasonable, inspectable ordering today and to
 * give a future tuning pass (real user feedback, click-through data,
 * etc.) a single, named place to change without touching retrieval
 * logic itself.
 */

export interface RankingSignals {
  /** Cosine similarity to the query embedding, clamped to [0, 1]; 0 if no embedding was available for this memory or no query embedding could be generated. */
  semanticSimilarity: number;
  /** Postgres ts_rank score for the query against memory content, normalized to roughly [0, 1]; 0 if no lexical match. */
  lexicalScore: number;
  /** 1.0 if the memory is linked to an entity the query directly named, a documented lower value if linked only via one hop of graph expansion, 0 otherwise. */
  entityMatchScore: number;
  /** Recency decay in [0, 1] — 1.0 for "just happened/just recorded", decaying toward 0 with age. Computed from occurredAt when known, createdAt otherwise (see retrieval.service.ts). */
  recencyScore: number;
  /** memory.importance (1-5) normalized to [0, 1]. */
  importanceScore: number;
  /** memory.confidence, already [0, 1]; epistemic status is not separately weighted here (see RankingWeights doc) — confidence is where that nuance lives, since 'inferred'/'probable' memories are expected to carry lower confidence than 'explicit' ones. */
  confidenceScore: number;
}

export interface RankingWeights {
  semanticSimilarity: number;
  lexicalScore: number;
  entityMatchScore: number;
  recencyScore: number;
  importanceScore: number;
  confidenceScore: number;
}

/**
 * Initial heuristic weights (sum to 1.0, not required but keeps the
 * combined score itself roughly in [0, 1] for readability). Semantic
 * similarity dominates since it's the signal most likely to surface
 * genuinely relevant memories the query's exact words don't match;
 * entity matches are weighted second-highest because an exact,
 * unambiguous "this memory is about the person/project you named" is
 * strong, cheap-to-trust evidence. Recency/importance/confidence are
 * intentionally minor tie-breakers, not primary drivers — Twin should
 * not bury an important old memory under a trivial recent one.
 */
export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  semanticSimilarity: 0.35,
  lexicalScore: 0.15,
  entityMatchScore: 0.25,
  recencyScore: 0.1,
  importanceScore: 0.1,
  confidenceScore: 0.05,
};

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Combines a signal bundle into one comparable score. Pure — same input always produces the same output. */
export function computeRankScore(signals: RankingSignals, weights: RankingWeights = DEFAULT_RANKING_WEIGHTS): number {
  return (
    clamp01(signals.semanticSimilarity) * weights.semanticSimilarity +
    clamp01(signals.lexicalScore) * weights.lexicalScore +
    clamp01(signals.entityMatchScore) * weights.entityMatchScore +
    clamp01(signals.recencyScore) * weights.recencyScore +
    clamp01(signals.importanceScore) * weights.importanceScore +
    clamp01(signals.confidenceScore) * weights.confidenceScore
  );
}

/** Half-life for the recency decay curve, in days — another named, documented heuristic rather than a magic number inline. A memory whose relevant date is exactly this many days old scores 0.5 on recency. */
export const RECENCY_HALF_LIFE_DAYS = 30;

/** Exponential decay: score 1.0 at age 0, 0.5 at RECENCY_HALF_LIFE_DAYS, asymptotically approaching (never reaching) 0 for very old memories. */
export function computeRecencyScore(referenceDate: Date, now: Date = new Date()): number {
  const ageMs = Math.max(0, now.getTime() - referenceDate.getTime());
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

/** memory.importance is stored 1-5; maps to [0, 1] linearly (1 -> 0, 5 -> 1). */
export function normalizeImportance(importance: number): number {
  return clamp01((importance - 1) / 4);
}

/** How strongly a memory's entity links match the query's directly-named vs. graph-expanded entities. Documented, bounded values — not tuned, just distinct enough to be meaningfully ordered. */
export const ENTITY_MATCH_DIRECT = 1.0;
export const ENTITY_MATCH_EXPANDED = 0.5;
export const ENTITY_MATCH_NONE = 0;
