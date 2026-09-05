import { describe, expect, it } from 'vitest';
import type { IngestionJobDto } from '@twin/contracts';
import { toIngestionActivityItem } from './ingestionActivity';

function makeJob(overrides: Partial<IngestionJobDto> = {}): IngestionJobDto {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    inputType: 'text',
    status: 'completed',
    statusHistory: [],
    extractionProvider: 'heuristic-v1',
    extractionResult: null,
    isDuplicate: false,
    resultMemoryId: '00000000-0000-0000-0000-000000000002',
    errorMessage: null,
    createdAt: '2026-01-01T12:00:00.000Z',
    updatedAt: '2026-01-01T12:00:01.000Z',
    completedAt: '2026-01-01T12:00:01.000Z',
    ...overrides,
  };
}

describe('toIngestionActivityItem', () => {
  it('a completed, non-duplicate job is labeled "Captured" and links to its real memory', () => {
    const item = toIngestionActivityItem(makeJob());
    expect(item.subtitle).toBe('Captured');
    expect(item.status).toBe('completed');
    expect(item.canViewMemory).toBe(true);
  });

  it('a completed duplicate job is honestly labeled as a duplicate, not a fresh capture', () => {
    const item = toIngestionActivityItem(makeJob({ isDuplicate: true }));
    expect(item.subtitle).toBe('Duplicate — already in your vault');
    expect(item.canViewMemory).toBe(true);
  });

  it('a failed job surfaces its real stored error message, never a generic placeholder', () => {
    const item = toIngestionActivityItem(
      makeJob({ status: 'failed', resultMemoryId: null, completedAt: null, errorMessage: 'Could not reach the URL.' }),
    );
    expect(item.subtitle).toBe('Failed — Could not reach the URL.');
    expect(item.canViewMemory).toBe(false);
  });

  it('a failed job with no stored error message still says it failed, never fabricating a reason', () => {
    const item = toIngestionActivityItem(makeJob({ status: 'failed', resultMemoryId: null, errorMessage: null }));
    expect(item.subtitle).toBe('Failed');
  });

  it('truncates an overlong stored error message for display rather than overflowing the row', () => {
    const longMessage = 'x'.repeat(300);
    const item = toIngestionActivityItem(makeJob({ status: 'failed', errorMessage: longMessage }));
    expect(item.subtitle.length).toBeLessThan(longMessage.length);
    expect(item.subtitle.endsWith('…')).toBe(true);
  });

  it('a pending job is labeled honestly as pending, never as an active fake animation', () => {
    const item = toIngestionActivityItem(makeJob({ status: 'pending', resultMemoryId: null, completedAt: null }));
    expect(item.subtitle).toBe('Pending');
    expect(item.canViewMemory).toBe(false);
  });

  it('a processing job is labeled as processing', () => {
    const item = toIngestionActivityItem(makeJob({ status: 'processing', resultMemoryId: null, completedAt: null }));
    expect(item.subtitle).toBe('Processing…');
  });

  it('maps every real input type to a distinct, non-fabricated label', () => {
    const types: IngestionJobDto['inputType'][] = ['text', 'voice_transcript', 'web_link', 'document', 'image'];
    const labels = types.map((inputType) => toIngestionActivityItem(makeJob({ inputType })).title);
    expect(new Set(labels).size).toBe(types.length);
  });

  it('prefers completedAt for the timestamp when present, falling back to createdAt otherwise', () => {
    const completed = toIngestionActivityItem(makeJob({ createdAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-02T00:00:00.000Z' }));
    const pending = toIngestionActivityItem(makeJob({ status: 'pending', resultMemoryId: null, createdAt: '2026-01-01T00:00:00.000Z', completedAt: null }));
    expect(completed.timestamp).not.toBe(pending.timestamp);
  });

  it('canViewMemory is false whenever resultMemoryId is null, regardless of status', () => {
    const item = toIngestionActivityItem(makeJob({ resultMemoryId: null }));
    expect(item.canViewMemory).toBe(false);
  });

  describe('Phase 31 — structured knowledge summary from real extraction results', () => {
    it('surfaces real entity/relationship/note counts when AI extraction stored something', () => {
      const item = toIngestionActivityItem(
        makeJob({
          extractionResult: {
            status: 'completed',
            provider: 'gemini-2.5-flash',
            storage: { entities: [{}, {}], relationships: [{}], memoryIds: ['a'] },
          },
        }),
      );
      expect(item.subtitle).toBe('Structured knowledge added — 2 entities, 1 relationship, 1 note');
    });

    it('falls back to "Captured" when extraction completed but stored nothing (an honest empty result)', () => {
      const item = toIngestionActivityItem(
        makeJob({
          extractionResult: { status: 'completed', provider: 'gemini-2.5-flash', storage: { entities: [], relationships: [], memoryIds: [] } },
        }),
      );
      expect(item.subtitle).toBe('Captured');
    });

    it('falls back to "Captured" when no AI provider ran at all (extractionResult null)', () => {
      const item = toIngestionActivityItem(makeJob({ extractionResult: null }));
      expect(item.subtitle).toBe('Captured');
    });

    it('falls back to "Captured" when AI extraction failed — never claims structured knowledge that was not actually stored', () => {
      const item = toIngestionActivityItem(
        makeJob({ extractionResult: { status: 'failed', provider: 'gemini-2.5-flash', error: 'timeout' } }),
      );
      expect(item.subtitle).toBe('Captured');
    });

    it('a duplicate job never shows a structured-knowledge summary, even if extractionResult somehow carries one', () => {
      const item = toIngestionActivityItem(
        makeJob({
          isDuplicate: true,
          extractionResult: {
            status: 'completed',
            provider: 'gemini-2.5-flash',
            storage: { entities: [{}], relationships: [], memoryIds: [] },
          },
        }),
      );
      expect(item.subtitle).toBe('Duplicate — already in your vault');
    });
  });
});
