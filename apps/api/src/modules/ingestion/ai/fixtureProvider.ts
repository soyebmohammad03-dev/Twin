import { AIProviderError, type AIExtractionContext, type AIProvider, type AIProviderErrorCode } from './types.js';

/**
 * A deterministic, non-AI stand-in for AIProvider, used only by tests
 * (never imported by getAIProvider()/env resolution — there is no way
 * to select it via configuration). Each instance returns a fixed raw
 * response (or throws a fixed error) regardless of input, so tests
 * can assert exactly how the pipeline handles a given AI output
 * without depending on real model behavior or network access.
 */
export class FixtureAIProvider implements AIProvider {
  readonly name = 'fixture-test-provider';
  private readonly response: string | { error: AIProviderErrorCode; message: string };

  constructor(response: string | { error: AIProviderErrorCode; message: string }) {
    this.response = response;
  }

  async analyze(_context: AIExtractionContext): Promise<string> {
    if (typeof this.response === 'string') {
      return this.response;
    }
    throw new AIProviderError(this.response.message, this.response.error);
  }
}
