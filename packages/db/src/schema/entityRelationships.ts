import { pgTable, uuid, text, timestamp, numeric, index, unique, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { entities } from './entities.js';
import { epistemicStatusEnum } from './memories.js';
import { memories } from './memories.js';

/**
 * Directed edges of the knowledge graph — how entities relate to each
 * other, independent of any specific memory (e.g. "Sarah works_with
 * Project Helios"). Symmetric relationships (e.g. "friend_of") are
 * stored as a single row and read in either direction by the
 * application; directional ones (e.g. "reports_to") are stored
 * from -> to as stated.
 *
 * One row per unique (from, to, type) edge — this is the *current
 * known* state of that edge, not a log of every time it was learned.
 * The full history of what supports it lives in `relationship_evidence`
 * (one row per memory that evidenced this edge); this row's
 * epistemicStatus/confidence/extractionMethod/sourceMemoryId reflect
 * the *strongest* evidence seen so far (see
 * modules/graph/graph.service.ts's mergeEpistemicStrength), and
 * updatedAt moves forward every time new evidence arrives, even if the
 * rollup values themselves don't change.
 */
export const entityRelationships = pgTable(
  'entity_relationships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fromEntityId: uuid('from_entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    toEntityId: uuid('to_entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    // e.g. "works_with", "reports_to", "part_of", "friend_of" — open
    // vocabulary, not a DB enum.
    relationshipType: text('relationship_type').notNull(),
    // Reuses memories' own epistemic classification — a relationship
    // carries the exact same "how do we know this" distinction a
    // memory does: explicit / from_source / reported_by_other /
    // inferred / probable. Never collapsed to a single "known/unknown"
    // boolean.
    epistemicStatus: epistemicStatusEnum('epistemic_status').notNull().default('inferred'),
    // 0.00-1.00, always populated (mirrors memories.confidence) —
    // meaningful mainly for inferred/probable relationships;
    // explicit/from_source ones default to full confidence.
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull().default('1.00'),
    // Free-text, open vocabulary (mirrors memories.memoryType): e.g.
    // "ai-gemini-extraction", "heuristic-mention-linking",
    // "user-declared". Which mechanism produced/last-strengthened this
    // edge, for audit — not a DB enum, since new extraction methods
    // will appear over time.
    extractionMethod: text('extraction_method').notNull(),
    // The memory that produced the *strongest* evidence for this edge
    // (see relationship_evidence for the complete evidence history).
    // Nullable + set null (not cascaded) on delete: if that specific
    // memory is later hard-deleted, the relationship itself is still a
    // real, previously-evidenced edge — it doesn't vanish, it just
    // loses this one pointer. Soft-archiving a memory does NOT touch
    // this column at all.
    sourceMemoryId: uuid('source_memory_id').references(() => memories.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('entity_relationships_user_id_idx').on(table.userId),
    index('entity_relationships_to_entity_id_idx').on(table.toEntityId),
    index('entity_relationships_source_memory_id_idx').on(table.sourceMemoryId),
    unique('entity_relationships_from_to_type_unique').on(
      table.fromEntityId,
      table.toEntityId,
      table.relationshipType,
    ),
    check('entity_relationships_no_self_loop', sql`${table.fromEntityId} <> ${table.toEntityId}`),
    check(
      'entity_relationships_confidence_range',
      sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`,
    ),
  ],
);

/**
 * One row per (relationship, memory) pair — the actual evidence trail
 * behind a relationship's rollup fields above. This is how Twin
 * answers "why do you think Arjun is connected to the Drone Project":
 * fetch every row here for that relationship, each pointing at a real
 * memory with its own epistemic status, confidence, and quoted
 * evidence text, exactly as extracted at the time. Never overwritten —
 * a relationship re-mentioned in five different captures accumulates
 * five rows here, preserving the full history (item 8's temporal
 * graph requirement), not just the latest state.
 */
export const relationshipEvidence = pgTable(
  'relationship_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    relationshipId: uuid('relationship_id')
      .notNull()
      .references(() => entityRelationships.id, { onDelete: 'cascade' }),
    memoryId: uuid('memory_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    epistemicStatus: epistemicStatusEnum('epistemic_status').notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    extractionMethod: text('extraction_method').notNull(),
    // The verbatim (grounded) quote from the memory's content that
    // supports this relationship, when extraction produced one —
    // nullable since a future non-AI evidence path (e.g. a user
    // directly declaring a relationship) may have no quote to show.
    evidenceText: text('evidence_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('relationship_evidence_relationship_id_idx').on(table.relationshipId),
    index('relationship_evidence_memory_id_idx').on(table.memoryId),
    index('relationship_evidence_user_id_idx').on(table.userId),
    unique('relationship_evidence_relationship_memory_unique').on(table.relationshipId, table.memoryId),
    check(
      'relationship_evidence_confidence_range',
      sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`,
    ),
  ],
);
