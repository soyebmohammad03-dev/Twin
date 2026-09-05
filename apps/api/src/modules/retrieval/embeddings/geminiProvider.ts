import { EmbeddingProviderError, type EmbeddingProvider, type EmbeddingResult } from './types.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiEmbedContentResponse {
  embedding?: { values?: number[] };
}

function l2Normalize(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return values;
  return values.map((v) => v / norm);
}

/**
 * Real Gemini implementation of EmbeddingProvider, via the same
 * fetch-based REST pattern as ingestion/ai/geminiProvider.ts.
 *
 * gemini-embedding-001's native output is 3072-d and is NOT unit-length
 * normalized after being truncated to a smaller `outputDimensionality`
 * (verified live: the 1536-d truncated response had norm ≈0.70, not
 * 1.0) — cosine distance is scale-invariant so this wouldn't corrupt
 * pgvector's `<=>` comparisons either way, but this provider
 * normalizes explicitly anyway so every stored vector is unit-length
 * and self-consistent regardless of which distance operator is used.
 */
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(apiKey: string, model: string, dimensions: number, timeoutMs: number) {
    this.apiKey = apiKey;
    this.model = model;
    this.dimensions = dimensions;
    this.timeoutMs = timeoutMs;
    this.name = model;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${GEMINI_API_BASE}/${this.model}:embedContent?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          content: { parts: [{ text }] },
          outputDimensionality: this.dimensions,
        }),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new EmbeddingProviderError(`Gemini embedding request timed out after ${this.timeoutMs}ms.`, 'timeout', err);
      }
      throw new EmbeddingProviderError('Network error calling Gemini embeddings.', 'network', err);
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 429) {
      throw new EmbeddingProviderError('Gemini embedding rate limit exceeded.', 'rate_limited');
    }
    if (response.status === 401 || response.status === 403) {
      throw new EmbeddingProviderError('Gemini rejected the API key (unauthorized).', 'unauthorized');
    }
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new EmbeddingProviderError(
        `Gemini embedding request failed: HTTP ${response.status}. ${bodyText.slice(0, 300)}`,
        'unknown',
      );
    }

    let body: GeminiEmbedContentResponse;
    try {
      body = (await response.json()) as GeminiEmbedContentResponse;
    } catch (err) {
      throw new EmbeddingProviderError('Gemini embedding response was not valid JSON.', 'invalid_response', err);
    }

    const values = body.embedding?.values;
    if (!values || values.length === 0) {
      throw new EmbeddingProviderError('Gemini embedding response contained no vector values.', 'invalid_response');
    }
    if (values.length !== this.dimensions) {
      throw new EmbeddingProviderError(
        `Gemini returned a ${values.length}-dimension embedding; expected ${this.dimensions}.`,
        'wrong_dimension',
      );
    }

    return { values: l2Normalize(values), dimensions: this.dimensions };
  }
}
