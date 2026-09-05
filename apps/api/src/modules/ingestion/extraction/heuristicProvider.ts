import { and, eq, isNull } from 'drizzle-orm';
import { entities, type Queryable } from '@twin/db';
import type { ExtractionInput, ExtractionOutput, ExtractionProvider } from './types.js';
import { containsWholeWord } from '../../retrieval/textMatch.js';

/**
 * The only extraction implementation in this phase. It does NOT call
 * any AI model. It only:
 *
 *   1. Passes the input content through unchanged.
 *   2. Finds exact, case-insensitive, whole-word matches of the
 *      user's EXISTING entity names within the text, and links to
 *      them (role: 'mentioned').
 *
 * It never creates new entities from guesses — inventing "Twin Vault"
 * or "Monday" as a new person/project from a capitalization pattern
 * would pollute the knowledge graph with false positives, which a
 * naive heuristic has no business doing. It never assigns
 * 'inferred'/'probable' epistemic status itself, because it isn't
 * actually inferring anything — that classification is either the
 * caller's explicit choice or the ingestion service's per-type
 * default (see ingestion.service.ts). A real NLP/LLM-based provider
 * belongs behind this same interface later, not built here.
 */
export class HeuristicExtractionProvider implements ExtractionProvider {
  readonly name = 'heuristic-v1';

  async extract(input: ExtractionInput, db: Queryable): Promise<ExtractionOutput> {
    const candidates = await db
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .where(and(eq(entities.userId, input.userId), isNull(entities.archivedAt)));

    const lowerContent = input.content.toLowerCase();
    const entityLinks = candidates
      .filter((entity) => entity.name.trim().length >= 2 && containsWholeWord(lowerContent, entity.name))
      .map((entity) => ({ entityId: entity.id, role: 'mentioned' }));

    return { content: input.content, entityLinks };
  }
}
