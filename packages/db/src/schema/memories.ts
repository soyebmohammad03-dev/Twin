import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  numeric,
  smallint,
  pgEnum,
  vector,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { sources } from './sources.js';

/**
 * Twin's core epistemic classification — directly implements the
 * product's provenance/epistemic-separation principle: Twin must
 * distinguish what it was explicitly told, what it read in a supplied
 * source, what someone else reportedly said, and what it inferred or
 * merely suspects. "Unknown" is deliberately not a value here — a gap
 * is the absence of a memory, not a memory with low confidence.
 */
export const epistemicStatusEnum = pgEnum('epistemic_status', [
  'explicit', // the user told Twin this directly
  'from_source', // stated in a source document/file the user provided
  'reported_by_other', // another person said this — see memory_entities for who, via role 'reported_by'
  'inferred', // Twin derived this from other memories
  'probable', // Twin believes this is likely true, but is not confident
]);

/**
 * Phase 6: populated by apps/api/src/modules/retrieval/embeddings.
 * Chosen to match Gemini's `gemini-embedding-001`, whose native output
 * is 3072 dimensions but which supports `outputDimensionality: 1536`
 * (Matryoshka truncation, verified live against the real API) — kept
 * at the original Phase 2 placeholder value so no migration/reindex of
 * this column's type was needed. Truncated vectors are re-normalized
 * (L2) by the embedding provider before storage, since Gemini does not
 * renormalize a truncated embedding itself.
 */
export const EMBEDDING_DIMENSIONS = 1536;

export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),

    // Free-text classification (e.g. "note", "fact", "preference",
    // "decision_record", "reflection", "conversation_summary") — kept
    // as text rather than a DB enum since this taxonomy will evolve
    // once the real ingestion pipeline exists and usage is observed.
    memoryType: text('memory_type').notNull().default('note'),

    content: text('content').notNull(),

    // SHA-256 of the normalized (trimmed/collapsed-whitespace/lowercased)
    // content, computed on every insert regardless of creation path.
    // Exact/near-exact duplicate detection only — no embeddings, no
    // fuzzy/semantic matching. Nullable for forward compatibility with
    // any pre-existing rows created before this column existed.
    contentHash: text('content_hash'),

    epistemicStatus: epistemicStatusEnum('epistemic_status').notNull().default('explicit'),
    // 0.00–1.00. Meaningful mainly for 'inferred'/'probable' memories;
    // 'explicit'/'from_source' memories default to full confidence.
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull().default('1.00'),
    // 1 (low) – 5 (high), default 3 (medium).
    importance: smallint('importance').notNull().default(3),

    // When the remembered thing actually happened, if that's known and
    // different from when Twin recorded it. Null means "same as
    // createdAt" — don't duplicate the value for the common case.
    occurredAt: timestamp('occurred_at', { withTimezone: true }),

    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    // Which provider/model produced the current `embedding` value, and
    // when — the idempotency + staleness signal for the embedding
    // pipeline (apps/api/src/modules/retrieval/embedding.service.ts):
    // re-embed only when this is null, names a different model than
    // the one currently configured, or the row's contentHash has
    // changed since. Both null together means "never embedded yet".
    embeddingModel: text('embedding_model'),
    embeddingGeneratedAt: timestamp('embedding_generated_at', { withTimezone: true }),
    // hashMemoryContent() of whatever content was actually embedded —
    // compared against the row's *current* contentHash to detect
    // staleness independently of embeddingModel. (Note: updateMemory()
    // does not currently recompute contentHash when content changes —
    // a pre-existing Phase 3 gap, not introduced or fixed here — so in
    // practice today this only ever differs from contentHash if the
    // configured model changes, but storing it separately keeps this
    // check correct if that gap is fixed later.)
    embeddingContentHash: text('embedding_content_hash'),

    metadata: jsonb('metadata').notNull().default({}),

    // Soft delete — supports "forgetting" a memory without losing the
    // audit trail of the fact that it once existed and was removed.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('memories_user_id_idx').on(table.userId),
    index('memories_source_id_idx').on(table.sourceId),
    index('memories_user_id_content_hash_idx').on(table.userId, table.contentHash),
    index('memories_user_id_occurred_at_idx').on(table.userId, table.occurredAt),
    index('memories_user_id_memory_type_idx').on(table.userId, table.memoryType),
    index('memories_deleted_at_idx').on(table.deletedAt),
    check('memories_confidence_range', sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`),
    check('memories_importance_range', sql`${table.importance} >= 1 AND ${table.importance} <= 5`),
  ],
);
