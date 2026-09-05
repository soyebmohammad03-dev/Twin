import { HeuristicExtractionProvider } from './heuristicProvider.js';
import type { ExtractionProvider } from './types.js';

export type { ExtractionInput, ExtractionOutput, ExtractionProvider, ExtractedEntityLink } from './types.js';

const heuristicProvider = new HeuristicExtractionProvider();

/**
 * The cheap, deterministic, zero-network baseline for the primary
 * memory's entity links — always runs, independent of
 * EXTRACTION_PROVIDER. That env var now governs only whether the
 * *additional* AI enrichment stage (see ../ai/index.ts's
 * getAIProvider) also runs on top of this baseline; it is no longer a
 * mutually-exclusive "pick one provider" switch, so this function
 * doesn't branch on it at all.
 */
export function getExtractionProvider(): ExtractionProvider {
  return heuristicProvider;
}
