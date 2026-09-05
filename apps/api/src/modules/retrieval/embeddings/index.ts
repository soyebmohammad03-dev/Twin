import { EMBEDDING_DIMENSIONS } from '@twin/db';
import { env } from '../../../config/env.js';
import { GeminiEmbeddingProvider } from './geminiProvider.js';
import type { EmbeddingProvider } from './types.js';

export type { EmbeddingProvider, EmbeddingResult, EmbeddingProviderErrorCode } from './types.js';
export { EmbeddingProviderError } from './types.js';

/**
 * Resolves the configured embedding provider, or null if none is
 * configured (EMBEDDING_PROVIDER=none, the default). Mirrors
 * modules/ingestion/ai/index.ts's getAIProvider() exactly — returning
 * null rather than a fake/no-op provider keeps "not configured" and
 * "configured but failing" distinguishable to callers, and adding a
 * second real provider later means one more case here, nothing else
 * in embedding.service.ts or retrieval.service.ts changes.
 */
export function getEmbeddingProvider(): EmbeddingProvider | null {
  switch (env.EMBEDDING_PROVIDER) {
    case 'gemini':
      // env.ts's refine() already guarantees GEMINI_API_KEY is set
      // whenever EMBEDDING_PROVIDER=gemini reached runtime.
      return new GeminiEmbeddingProvider(env.GEMINI_API_KEY!, env.EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, env.EMBEDDING_TIMEOUT_MS);
    case 'none':
      return null;
    default:
      return null;
  }
}
