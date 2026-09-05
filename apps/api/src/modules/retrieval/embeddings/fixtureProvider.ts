import type { EmbeddingProvider, EmbeddingResult } from './types.js';

/**
 * A deterministic, non-AI stand-in for EmbeddingProvider, used only by
 * tests (never selectable via EMBEDDING_PROVIDER env config). Unlike
 * ingestion/ai/fixtureProvider.ts (which returns one fixed canned
 * response regardless of input), this one needs to produce genuinely
 * *different* vectors for different text so semantic-search tests can
 * assert that similar text ranks higher than unrelated text — a
 * single canned vector couldn't exercise that.
 *
 * Implementation: a simple bag-of-words hashing-trick embedding. Each
 * word deterministically seeds a small PRNG that spreads a unit
 * contribution across every dimension; word vectors are summed then
 * L2-normalized. Two texts sharing more vocabulary end up with higher
 * cosine similarity — not a real semantic model, but enough structure
 * to make ranking tests meaningful and fully reproducible without any
 * network access.
 */
export class FixtureEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'fixture-test-embeddings';
  readonly dimensions: number;

  constructor(dimensions = 1536) {
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? ['empty'];
    const vector = new Array(this.dimensions).fill(0);

    for (const word of words) {
      const rng = mulberry32(fnv1aHash(word));
      for (let i = 0; i < this.dimensions; i++) {
        vector[i] += rng() * 2 - 1;
      }
    }

    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return { values: vector.map((v) => v / norm), dimensions: this.dimensions };
  }
}

function fnv1aHash(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
