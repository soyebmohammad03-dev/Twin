import { describe, expect, it } from 'vitest';
import {
  parseStructuredExtraction,
  validateExtractionResult,
  isGrounded,
  ExtractionParseError,
  MIN_CONFIDENCE,
} from '../src/modules/ingestion/extraction/pipeline.js';

/**
 * Pure, no-DB, no-network tests for the pipeline's structured
 * extraction and validation (confidence + groundedness) stages — the
 * stages responsible for "never invent information", so they get
 * direct, deterministic coverage independent of any real AI provider.
 *
 * Entity resolution (planEntityResolution/normalizeEntityName) moved
 * to modules/graph/entityResolution.ts in Phase 7, shared with the
 * direct POST /entities path — its tests moved with it to
 * test/graph.entityResolution.test.ts.
 */

const SOURCE_CONTENT =
  'Had a great call with Sarah Chen about Project Helios today. She prefers async updates over live meetings and mentioned the launch is targeted for March 15th, 2027.';

describe('parseStructuredExtraction', () => {
  it('parses a valid, schema-conforming JSON response', () => {
    const raw = JSON.stringify({ entities: [], memories: [], relationships: [] });
    const result = parseStructuredExtraction(raw);
    expect(result).toEqual({ entities: [], memories: [], relationships: [] });
  });

  it('strips a ```json code fence some models add despite instructions', () => {
    const raw = '```json\n{"entities":[],"memories":[],"relationships":[]}\n```';
    const result = parseStructuredExtraction(raw);
    expect(result.entities).toEqual([]);
  });

  it('accepts a bare date-only startsAt/occurredAt (real models rarely emit full ISO datetimes) — regression for a live Gemini failure', () => {
    const raw = JSON.stringify({
      entities: [
        {
          type: 'event',
          name: 'Solstice Launch',
          epistemicStatus: 'explicit',
          confidence: 0.9,
          evidence: 'go-live is set for August 4th',
          startsAt: '2027-08-04',
        },
      ],
      memories: [],
      relationships: [],
    });
    const result = parseStructuredExtraction(raw);
    expect(result.entities[0].startsAt).toBe('2027-08-04');
  });

  it('Phase 31: accepts a decision entity with decisionStatus "decided" or "tentative"', () => {
    const raw = JSON.stringify({
      entities: [
        {
          type: 'decision',
          name: 'Remote work',
          epistemicStatus: 'explicit',
          confidence: 0.9,
          evidence: "I've decided to work remotely",
          decisionStatus: 'decided',
        },
      ],
      memories: [],
      relationships: [],
    });
    const result = parseStructuredExtraction(raw);
    expect(result.entities[0].decisionStatus).toBe('decided');
  });

  it('Phase 31: a decision entity with no decisionStatus field parses fine (optional, never required)', () => {
    const raw = JSON.stringify({
      entities: [
        { type: 'decision', name: 'Undecided thing', epistemicStatus: 'explicit', confidence: 0.6, evidence: 'a decision' },
      ],
      memories: [],
      relationships: [],
    });
    const result = parseStructuredExtraction(raw);
    expect(result.entities[0].decisionStatus).toBeUndefined();
  });

  it('Phase 31: rejects a decisionStatus value outside the closed enum (malformed output)', () => {
    const raw = JSON.stringify({
      entities: [
        {
          type: 'decision',
          name: 'X',
          epistemicStatus: 'explicit',
          confidence: 0.9,
          evidence: 'a decision',
          decisionStatus: 'maybe-decided-idk',
        },
      ],
      memories: [],
      relationships: [],
    });
    expect(() => parseStructuredExtraction(raw)).toThrow(ExtractionParseError);
  });

  it('Phase 32: accepts a goal entity with a resolvable targetDate', () => {
    const raw = JSON.stringify({
      entities: [
        {
          type: 'goal',
          name: 'Ship v2',
          epistemicStatus: 'explicit',
          confidence: 0.9,
          evidence: 'goal is to ship v2 by 2027-01-15',
          targetDate: '2027-01-15',
        },
      ],
      memories: [],
      relationships: [],
    });
    const result = parseStructuredExtraction(raw);
    expect(result.entities[0].targetDate).toBe('2027-01-15');
  });

  it('Phase 32: a goal entity with no targetDate field parses fine (optional, never guessed)', () => {
    const raw = JSON.stringify({
      entities: [{ type: 'goal', name: 'Vague goal', epistemicStatus: 'explicit', confidence: 0.7, evidence: 'a goal' }],
      memories: [],
      relationships: [],
    });
    const result = parseStructuredExtraction(raw);
    expect(result.entities[0].targetDate).toBeUndefined();
  });

  it('Phase 32: rejects a targetDate that is not a genuinely parseable date (malformed output)', () => {
    const raw = JSON.stringify({
      entities: [
        {
          type: 'goal',
          name: 'Vague goal',
          epistemicStatus: 'explicit',
          confidence: 0.7,
          evidence: 'a goal',
          targetDate: 'next month sometime',
        },
      ],
      memories: [],
      relationships: [],
    });
    expect(() => parseStructuredExtraction(raw)).toThrow(ExtractionParseError);
  });

  it('throws ExtractionParseError on invalid JSON', () => {
    expect(() => parseStructuredExtraction('{not json')).toThrow(ExtractionParseError);
  });

  it('throws ExtractionParseError on JSON that does not match the schema (malformed structured output)', () => {
    const raw = JSON.stringify({ entities: [{ type: 'not-a-real-type', name: 'X' }] });
    expect(() => parseStructuredExtraction(raw)).toThrow(ExtractionParseError);
  });

  it('throws ExtractionParseError when confidence is out of range', () => {
    const raw = JSON.stringify({
      entities: [],
      memories: [
        {
          kind: 'fact',
          content: 'x',
          epistemicStatus: 'explicit',
          confidence: 1.5,
          importance: 3,
          evidence: 'quote',
        },
      ],
      relationships: [],
    });
    expect(() => parseStructuredExtraction(raw)).toThrow(ExtractionParseError);
  });
});

describe('isGrounded', () => {
  it('is true for a verbatim quote from the source, modulo case/punctuation', () => {
    expect(isGrounded('prefers async updates over live meetings', SOURCE_CONTENT)).toBe(true);
    expect(isGrounded('PREFERS ASYNC UPDATES', SOURCE_CONTENT)).toBe(true);
  });

  it('is false for a quote that never appeared in the source (hallucinated evidence)', () => {
    expect(isGrounded('she wants to relocate to Berlin next year', SOURCE_CONTENT)).toBe(false);
  });

  it('is false for trivially short evidence that could match anything', () => {
    expect(isGrounded('a', SOURCE_CONTENT)).toBe(false);
  });
});

describe('validateExtractionResult', () => {
  it('keeps a well-grounded, sufficiently confident entity/memory/relationship', () => {
    const result = validateExtractionResult(
      {
        entities: [
          {
            type: 'person',
            name: 'Sarah Chen',
            epistemicStatus: 'explicit',
            confidence: 0.9,
            evidence: 'call with Sarah Chen',
          },
        ],
        memories: [
          {
            kind: 'preference',
            content: 'Sarah prefers async updates.',
            epistemicStatus: 'explicit',
            confidence: 0.85,
            importance: 3,
            relatedEntityNames: ['Sarah Chen'],
            evidence: 'prefers async updates over live meetings',
          },
        ],
        relationships: [],
      },
      SOURCE_CONTENT,
    );

    expect(result.entities).toHaveLength(1);
    expect(result.memories).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
  });

  it('drops an item below the confidence floor rather than storing a guess', () => {
    const result = validateExtractionResult(
      {
        entities: [
          {
            type: 'person',
            name: 'Sarah Chen',
            epistemicStatus: 'probable',
            confidence: MIN_CONFIDENCE - 0.05,
            evidence: 'call with Sarah Chen',
          },
        ],
        memories: [],
        relationships: [],
      },
      SOURCE_CONTENT,
    );

    expect(result.entities).toHaveLength(0);
    expect(result.dropped).toEqual([{ kind: 'entity', reason: 'low_confidence', name: 'Sarah Chen' }]);
  });

  it('drops an item whose evidence is not actually present in the source (hallucination guard)', () => {
    const result = validateExtractionResult(
      {
        entities: [],
        memories: [
          {
            kind: 'fact',
            content: 'Sarah is relocating to Berlin.',
            epistemicStatus: 'inferred',
            confidence: 0.8,
            importance: 3,
            relatedEntityNames: [],
            evidence: 'she wants to relocate to Berlin next year',
          },
        ],
        relationships: [],
      },
      SOURCE_CONTENT,
    );

    expect(result.memories).toHaveLength(0);
    expect(result.dropped[0].reason).toBe('ungrounded_evidence');
  });

  it('drops an event entity with no confidently-known date rather than inventing one', () => {
    const result = validateExtractionResult(
      {
        entities: [
          {
            type: 'event',
            name: 'Project Helios Launch',
            epistemicStatus: 'explicit',
            confidence: 0.9,
            evidence: 'the launch is targeted for March 15th, 2027',
            // no startsAt supplied
          },
        ],
        memories: [],
        relationships: [],
      },
      SOURCE_CONTENT,
    );

    expect(result.entities).toHaveLength(0);
    expect(result.dropped[0].reason).toBe('invalid_event_no_date');
  });

  it('keeps an event entity when a confident startsAt is supplied', () => {
    const result = validateExtractionResult(
      {
        entities: [
          {
            type: 'event',
            name: 'Project Helios Launch',
            epistemicStatus: 'explicit',
            confidence: 0.9,
            evidence: 'the launch is targeted for March 15th, 2027',
            startsAt: '2027-03-15T00:00:00.000Z',
          },
        ],
        memories: [],
        relationships: [],
      },
      SOURCE_CONTENT,
    );

    expect(result.entities).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
  });
});
