import type { EntityType } from '@twin/contracts';
import type { EntityRow } from '../entities/entities.service.js';

/**
 * Normalizes a name for exact-match entity resolution — case,
 * whitespace, and the specific punctuation classes named in the Phase
 * 7 brief (apostrophes/curly quotes, periods, hyphens/dashes) are
 * treated as the same name. Nothing fuzzier than that: this is still
 * an EXACT match after normalization, never edit-distance/similarity
 * scoring. "Alex" and "Alex Rivera" normalize to different strings and
 * will never match here — only real formatting noise around the same
 * name does (O'Brien/OBrien/O'Brien, Jean-Paul/Jean Paul, J. Smith/J Smith).
 *
 * Mirrors packages/db/migrations/0008_entity_name_normalization_unique.sql's
 * `normalize_entity_name` SQL function exactly — that migration adds a
 * real database-level unique index using the same logic, so even a
 * race between two concurrent requests can't create two entities that
 * normalize to the same (user, type, name). Keep both in sync if
 * either changes.
 */
export function normalizeEntityName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[‘’‚‛']/g, '')
    .replace(/\./g, '')
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface EntityMentionLike {
  type: EntityType;
  name: string;
  description?: string;
}

export interface EntityResolutionDecision<T extends EntityMentionLike = EntityMentionLike> {
  mention: T;
  action: 'reuse' | 'create';
  /** Existing entity id, when action is 'reuse'. */
  entityId?: string;
  /** Human-readable rationale, preserved for audit. */
  reasoning: string;
}

/** Finds the (at most one, thanks to the DB unique index) existing active entity whose normalized name+type matches. */
export function findExactMatch(name: string, entityType: EntityType, existing: EntityRow[]): EntityRow | undefined {
  const key = normalizeEntityName(name);
  return existing.find((e) => !e.archivedAt && e.entityType === entityType && normalizeEntityName(e.name) === key);
}

/**
 * Batch resolution for a set of entity mentions against a user's
 * existing entities — reuse-or-create, never fuzzy-merge. Pure
 * function, no DB access, so it's trivially unit-testable. Used by the
 * AI extraction pipeline (many mentions at once); entities.service.ts's
 * findOrCreateEntity wraps findExactMatch directly for the single-entity
 * HTTP creation path instead, since it doesn't need batch de-duplication.
 */
export function planEntityResolution<T extends EntityMentionLike>(
  mentions: T[],
  existing: EntityRow[],
): EntityResolutionDecision<T>[] {
  // De-dupe mentions of the same (type, normalized name) within one batch.
  const seen = new Map<string, T>();
  for (const mention of mentions) {
    const key = `${mention.type}:${normalizeEntityName(mention.name)}`;
    if (!seen.has(key)) seen.set(key, mention);
  }

  return [...seen.values()].map((mention) => {
    const match = findExactMatch(mention.name, mention.type, existing);
    if (match) {
      return {
        mention,
        action: 'reuse' as const,
        entityId: match.id,
        reasoning: `Exact name match (case/whitespace/punctuation-insensitive) against existing ${match.entityType} "${match.name}".`,
      };
    }
    return {
      mention,
      action: 'create' as const,
      reasoning: `No existing ${mention.type} matching "${mention.name}" — created as a new entity.`,
    };
  });
}
