import { GEMINI_RESPONSE_SCHEMA } from './schema.js';
import { buildExtractionPrompt } from './prompt.js';
import { AIProviderError, type AIExtractionContext, type AIProvider } from './types.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiGenerateContentResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
}

/**
 * Real Gemini implementation of AIProvider — talks to the
 * generativelanguage.googleapis.com REST API directly over fetch (no
 * SDK dependency; Node 20+'s built-in fetch is enough for one JSON
 * POST). Uses Gemini's constrained JSON output mode
 * (responseMimeType + responseSchema) so malformed output should be
 * rare, but the pipeline validates the result regardless — this
 * provider never assumes its own output is trustworthy.
 */
export class GeminiProvider implements AIProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(apiKey: string, model: string, timeoutMs: number) {
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.name = model;
  }

  async analyze(context: AIExtractionContext): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${GEMINI_API_BASE}/${this.model}:generateContent?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: buildExtractionPrompt(context) }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            responseSchema: GEMINI_RESPONSE_SCHEMA,
          },
        }),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new AIProviderError(`Gemini request timed out after ${this.timeoutMs}ms.`, 'timeout', err);
      }
      throw new AIProviderError('Network error calling Gemini.', 'network', err);
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 429) {
      throw new AIProviderError('Gemini rate limit exceeded.', 'rate_limited');
    }
    if (response.status === 401 || response.status === 403) {
      throw new AIProviderError('Gemini rejected the API key (unauthorized).', 'unauthorized');
    }
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new AIProviderError(
        `Gemini request failed: HTTP ${response.status}. ${bodyText.slice(0, 300)}`,
        'unknown',
      );
    }

    let body: GeminiGenerateContentResponse;
    try {
      body = (await response.json()) as GeminiGenerateContentResponse;
    } catch (err) {
      throw new AIProviderError('Gemini returned a non-JSON response body.', 'invalid_response', err);
    }

    if (body.promptFeedback?.blockReason) {
      throw new AIProviderError(`Gemini blocked the request: ${body.promptFeedback.blockReason}.`, 'invalid_response');
    }

    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new AIProviderError('Gemini response contained no usable text content.', 'invalid_response');
    }

    return text;
  }
}
