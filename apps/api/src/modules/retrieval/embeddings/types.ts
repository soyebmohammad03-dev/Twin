/**
 * The seam every embedding backend implements — mirrors
 * modules/ingestion/ai/types.ts's AIProvider abstraction so the
 * application never depends on one embedding vendor's SDK/response
 * shape outside this folder. embedding.service.ts (the pipeline) only
 * ever talks to this interface.
 */
export interface EmbeddingResult {
  /** L2-normalized float vector, length === dimensions. */
  values: number[];
  dimensions: number;
}

export type EmbeddingProviderErrorCode =
  | 'timeout'
  | 'rate_limited'
  | 'unauthorized'
  | 'invalid_response'
  | 'wrong_dimension'
  | 'network'
  | 'unknown';

export class EmbeddingProviderError extends Error {
  readonly code: EmbeddingProviderErrorCode;
  readonly cause?: unknown;

  constructor(message: string, code: EmbeddingProviderErrorCode, cause?: unknown) {
    super(message);
    this.name = 'EmbeddingProviderError';
    this.code = code;
    this.cause = cause;
  }
}

export interface EmbeddingProvider {
  /** Stored on memories.embedding_model for audit/staleness detection — e.g. "gemini-embedding-001". */
  readonly name: string;
  /** The dimension this provider is configured to produce — must match packages/db/src/schema/memories.ts's EMBEDDING_DIMENSIONS or embedding.service.ts rejects the result before it ever reaches the database. */
  readonly dimensions: number;
  /** Throws EmbeddingProviderError on any failure — never returns a fabricated or zero vector. */
  embed(text: string): Promise<EmbeddingResult>;
}
