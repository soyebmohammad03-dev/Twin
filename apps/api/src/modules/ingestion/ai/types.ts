import type { EntityType } from '@twin/contracts';

/**
 * The seam every AI extraction backend implements. The application
 * never imports a provider SDK/type directly outside this folder —
 * everything downstream (extraction/pipeline.ts) talks to this
 * interface only, so adding a second provider (OpenAI, Anthropic,
 * a local model) later means writing one new class here, not
 * touching the pipeline, the ingestion service, or any route.
 *
 * A provider's only job is turning (content, known entity names) into
 * a raw JSON string matching aiExtractionResultSchema (schema.ts) —
 * it does not parse, validate, resolve entities, or write to the
 * database. Those are pipeline.ts's job, deliberately kept separate
 * so they can be tested without a live model.
 */
export interface AIExtractionContext {
  content: string;
  /** The user's existing entities, by type+name only — enough for the model to say "this matches something you already know about" without exposing internal ids in the prompt. */
  existingEntities: { type: EntityType; name: string }[];
}

export type AIProviderErrorCode =
  | 'timeout'
  | 'rate_limited'
  | 'unauthorized'
  | 'invalid_response'
  | 'network'
  | 'unknown';

/**
 * Every failure mode a provider call can hit, normalized to one type
 * so the pipeline can handle them uniformly (log, record on the
 * ingestion job, never let one propagate as an uncaught rejection
 * that could leave a job stuck mid-transition).
 */
export class AIProviderError extends Error {
  readonly code: AIProviderErrorCode;
  readonly cause?: unknown;

  constructor(message: string, code: AIProviderErrorCode, cause?: unknown) {
    super(message);
    this.name = 'AIProviderError';
    this.code = code;
    this.cause = cause;
  }
}

export interface AIProvider {
  /** Stored on the ingestion job for audit — e.g. "gemini-2.5-flash". */
  readonly name: string;
  /** Returns the model's raw text response — expected to be a JSON string, but NOT parsed or validated here. Throws AIProviderError on any failure (never returns fabricated/placeholder content). */
  analyze(context: AIExtractionContext): Promise<string>;
}
