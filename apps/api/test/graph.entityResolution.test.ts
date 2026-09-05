import { describe, expect, it } from 'vitest';
import { normalizeEntityName, planEntityResolution, findExactMatch } from '../src/modules/graph/entityResolution.js';
import type { EntityRow } from '../src/modules/entities/entities.service.js';

/**
 * Pure, no-DB tests for Phase 7's shared entity resolution module —
 * used by both the AI extraction pipeline (batch resolution) and the
 * direct POST /entities path (entities.service.ts's findOrCreateEntity).
 * These tests moved from ai-extraction.pipeline.test.ts when the logic
 * did, in Phase 7, plus new coverage for the punctuation normalization
 * added in that phase.
 */

function makeEntityRow(overrides: Partial<EntityRow>): EntityRow {
  return {
    id: 'entity-id',
    userId: 'user-id',
    entityType: 'person',
    name: 'Sarah Chen',
    description: null,
    metadata: {},
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as EntityRow;
}

describe('normalizeEntityName', () => {
  it('lowercases and trims', () => {
    expect(normalizeEntityName('  ALEX Rivera  ')).toBe('alex rivera');
  });

  it('collapses internal whitespace', () => {
    expect(normalizeEntityName('Alex   Rivera')).toBe('alex rivera');
  });

  it('removes apostrophes and curly quotes', () => {
    expect(normalizeEntityName("O'Brien")).toBe('obrien');
    expect(normalizeEntityName('O’Brien')).toBe('obrien');
  });

  it('removes periods (initials)', () => {
    expect(normalizeEntityName('J. Smith')).toBe('j smith');
  });

  it('turns hyphens/dashes into spaces rather than deleting them', () => {
    expect(normalizeEntityName('Jean-Paul')).toBe('jean paul');
    expect(normalizeEntityName('Jean Paul')).toBe('jean paul');
  });

  it('does NOT touch word-level differences — normalization is not fuzzy matching', () => {
    expect(normalizeEntityName('Alex')).not.toBe(normalizeEntityName('Alex Rivera'));
    expect(normalizeEntityName('John Smith')).not.toBe(normalizeEntityName('Jon Smith'));
  });
});

describe('findExactMatch', () => {
  it('matches across the normalized punctuation classes', () => {
    const existing = [makeEntityRow({ id: 'e1', name: "O'Brien", entityType: 'person' })];
    expect(findExactMatch('OBrien', 'person', existing)?.id).toBe('e1');
    expect(findExactMatch('O’Brien', 'person', existing)?.id).toBe('e1');
  });

  it('never matches "Alex" against "Alex Rivera" — no false merge from a substring/prefix relationship', () => {
    const existing = [makeEntityRow({ id: 'e1', name: 'Alex Rivera', entityType: 'person' })];
    expect(findExactMatch('Alex', 'person', existing)).toBeUndefined();
  });

  it('ignores archived entities', () => {
    const existing = [makeEntityRow({ id: 'e1', name: 'Sarah Chen', entityType: 'person', archivedAt: new Date() })];
    expect(findExactMatch('Sarah Chen', 'person', existing)).toBeUndefined();
  });

  it('requires both name and type to match', () => {
    const existing = [makeEntityRow({ id: 'e1', name: 'Helios', entityType: 'project' })];
    expect(findExactMatch('Helios', 'idea', existing)).toBeUndefined();
    expect(findExactMatch('Helios', 'project', existing)?.id).toBe('e1');
  });
});

describe('planEntityResolution', () => {
  it('reuses an existing entity on an exact, case-insensitive name match', () => {
    const existing = [makeEntityRow({ id: 'existing-1', name: 'Sarah Chen', entityType: 'person' })];
    const decisions = planEntityResolution(
      [{ type: 'person', name: 'sarah chen' }],
      existing,
    );

    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe('reuse');
    expect(decisions[0].entityId).toBe('existing-1');
  });

  it('creates a new entity when no existing entity has that exact name', () => {
    const decisions = planEntityResolution([{ type: 'person', name: 'Marcus Whitfield' }], []);

    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe('create');
  });

  it('never merges two people whose names merely look similar', () => {
    const existing = [makeEntityRow({ id: 'existing-1', name: 'John Smith', entityType: 'person' })];
    const decisions = planEntityResolution([{ type: 'person', name: 'Jon Smith' }], existing);

    expect(decisions[0].action).toBe('create');
  });

  it('never merges "Alex" into "Alex Rivera" — the exact example from the phase brief', () => {
    const existing = [makeEntityRow({ id: 'existing-1', name: 'Alex Rivera', entityType: 'person' })];
    const decisions = planEntityResolution([{ type: 'person', name: 'Alex' }], existing);

    expect(decisions[0].action).toBe('create');
  });

  it('does not reuse across different entity types even with the same name', () => {
    const existing = [makeEntityRow({ id: 'existing-1', name: 'Helios', entityType: 'project' })];
    const decisions = planEntityResolution([{ type: 'idea', name: 'Helios' }], existing);

    expect(decisions[0].action).toBe('create');
  });

  it('de-duplicates repeated mentions of the same entity within one extraction', () => {
    const decisions = planEntityResolution(
      [
        { type: 'person', name: 'Sarah Chen' },
        { type: 'person', name: 'sarah chen' },
      ],
      [],
    );

    expect(decisions).toHaveLength(1);
  });

  it('de-duplicates punctuation-only variants within one batch', () => {
    const decisions = planEntityResolution(
      [
        { type: 'person', name: "O'Brien" },
        { type: 'person', name: 'OBrien' },
      ],
      [],
    );

    expect(decisions).toHaveLength(1);
  });

  it('ignores an archived entity as a reuse candidate', () => {
    const existing = [makeEntityRow({ id: 'existing-1', name: 'Sarah Chen', entityType: 'person', archivedAt: new Date() })];
    const decisions = planEntityResolution([{ type: 'person', name: 'Sarah Chen' }], existing);

    expect(decisions[0].action).toBe('create');
  });
});
