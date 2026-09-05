import { env } from '../../../config/env.js';
import { GeminiProvider } from './geminiProvider.js';
import type { AIProvider } from './types.js';

export type { AIProvider, AIExtractionContext, AIProviderErrorCode } from './types.js';
export { AIProviderError } from './types.js';
export { aiExtractionResultSchema, type AIExtractionResult } from './schema.js';

/**
 * Resolves the configured AI provider, or null if AI extraction isn't
 * configured (EXTRACTION_PROVIDER=heuristic, the default). Returning
 * null rather than a no-op provider keeps the "AI ran vs. didn't run"
 * distinction visible to the caller instead of hidden behind a fake
 * implementation. Adding a second real provider later (OpenAI,
 * Anthropic, ...) means adding one more case here — nothing else in
 * the ingestion pipeline changes, since everything downstream only
 * knows about the AIProvider interface (types.ts).
 */
export function getAIProvider(): AIProvider | null {
  switch (env.EXTRACTION_PROVIDER) {
    case 'gemini':
      // env.ts's refine() already guarantees GEMINI_API_KEY is set
      // whenever EXTRACTION_PROVIDER=gemini reached runtime.
      return new GeminiProvider(env.GEMINI_API_KEY!, env.GEMINI_MODEL, env.GEMINI_TIMEOUT_MS);
    case 'heuristic':
      return null;
    default:
      return null;
  }
}
