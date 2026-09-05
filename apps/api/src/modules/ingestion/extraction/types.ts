import type { Queryable } from '@twin/db';

export interface ExtractionInput {
  userId: string;
  content: string;
}

export interface ExtractedEntityLink {
  entityId: string;
  role: string;
}

export interface ExtractionOutput {
  /** The content to store on the memory — a provider may lightly clean it, but must never fabricate content that wasn't in the input. */
  content: string;
  /** Only entities the user ALREADY has — providers must never invent new entities from guesses. */
  entityLinks: ExtractedEntityLink[];
}

/**
 * The seam for turning raw ingested content into structured signals
 * (right now: content passthrough + linking to existing entities).
 * `heuristicProvider.ts` is the only implementation in this phase — a
 * future LLM-backed provider (entity creation, real epistemic
 * inference, richer relationship detection) would implement this same
 * interface, selected via EXTRACTION_PROVIDER config, without any
 * caller needing to change.
 */
export interface ExtractionProvider {
  /** Stored on the ingestion job for audit — e.g. "heuristic-v1". */
  readonly name: string;
  extract(input: ExtractionInput, db: Queryable): Promise<ExtractionOutput>;
}
