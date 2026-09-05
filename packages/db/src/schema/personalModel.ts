import { pgTable, uuid, text, timestamp, numeric, integer, jsonb, index, unique, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { entities } from './entities.js';
import { entityRelationships } from './entityRelationships.js';
import { memories } from './memories.js';
import { epistemicStatusEnum } from './memories.js';

/**
 * Phase 9's Personal Model — a structured, evidence-backed derived
 * representation of what Twin currently knows/believes/infers about a
 * user, built FROM existing memories/entities/relationships rather
 * than duplicating them. See docs/architecture.md for the full design
 * note; the short version:
 *
 *   personal_model_facts     — one row per (user, category, subject),
 *                               the CURRENT rollup state (mirrors
 *                               entity_relationships' rollup pattern)
 *   personal_model_fact_evidence — append-only evidence trail per fact
 *                               (mirrors relationship_evidence)
 *   personal_model_snapshots — versioned point-in-time captures,
 *                               written only on an explicit rebuild
 *   personal_model_changes   — structured change-log entries, each
 *                               tied to evidence
 *
 * Facts are never deleted to reflect a "current" state change — a
 * superseded project fact stays in the table with
 * temporal_state = 'superseded', not removed. A user "dismissing" a
 * fact only sets dismissed_at (soft), never deletes evidence rows.
 */

/**
 * The taxonomy of Personal Model categories this phase actually
 * derives from grounded data (see modules/personalModel/categories.ts
 * for the single source of truth this column's values must match).
 * Kept as free text, not a DB enum, matching this schema's existing
 * convention (memories.memoryType, entityRelationships.relationshipType)
 * for taxonomies expected to evolve.
 */
export const personalModelFacts = pgTable(
  'personal_model_facts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    // Stable dedup key within (userId, category) — an entity id for
    // entity-grounded facts, or a normalized-phrase hash for
    // text-derived facts (preferences/constraints). See categories.ts.
    subjectKey: text('subject_key').notNull(),
    // Set only when the fact is grounded in a specific entity — null
    // for phrase-derived facts (preferences/constraints have no entity).
    subjectEntityId: uuid('subject_entity_id').references(() => entities.id, { onDelete: 'set null' }),
    factText: text('fact_text').notNull(),
    epistemicStatus: epistemicStatusEnum('epistemic_status').notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    // 'one_off' | 'stable' | 'changing' — see modules/personalModel/stability.ts
    stability: text('stability').notNull(),
    // 'current' | 'historical' | 'superseded' | 'outdated' | 'unresolved' — see modules/personalModel/temporal.ts
    temporalState: text('temporal_state').notNull(),
    firstObservedAt: timestamp('first_observed_at', { withTimezone: true }).notNull(),
    lastObservedAt: timestamp('last_observed_at', { withTimezone: true }).notNull(),
    observationCount: integer('observation_count').notNull().default(1),
    // Soft — a user "dismissing" a fact hides it from the default view
    // without destroying its evidence trail (item 21's explicit requirement).
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('personal_model_facts_user_id_idx').on(table.userId),
    index('personal_model_facts_user_id_category_idx').on(table.userId, table.category),
    index('personal_model_facts_subject_entity_id_idx').on(table.subjectEntityId),
    unique('personal_model_facts_user_category_subject_unique').on(table.userId, table.category, table.subjectKey),
    check('personal_model_facts_confidence_range', sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`),
  ],
);

/**
 * The full, append-only evidence trail behind a fact's rollup fields —
 * exactly relationship_evidence's pattern, generalized to also allow
 * evidence that isn't "a memory" (a user directly confirming or
 * correcting a fact through the UI is itself explicit evidence — the
 * strongest kind — even though it has no memoryId).
 */
export const personalModelFactEvidence = pgTable(
  'personal_model_fact_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    factId: uuid('fact_id')
      .notNull()
      .references(() => personalModelFacts.id, { onDelete: 'cascade' }),
    // 'memory' | 'relationship' | 'user_confirmation' | 'user_correction' | 'user_dismissal'
    evidenceSource: text('evidence_source').notNull(),
    memoryId: uuid('memory_id').references(() => memories.id, { onDelete: 'cascade' }),
    relationshipId: uuid('relationship_id').references(() => entityRelationships.id, { onDelete: 'set null' }),
    entityId: uuid('entity_id').references(() => entities.id, { onDelete: 'set null' }),
    epistemicStatus: epistemicStatusEnum('epistemic_status').notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    // The quoted/derived snippet a memory-sourced row was matched from,
    // or the user's own words for a correction/confirmation.
    evidenceText: text('evidence_text'),
    // When the underlying observation happened (memory's occurredAt/
    // createdAt for memory evidence, or now() for a user action) —
    // distinct from createdAt, which is when Twin recorded the evidence row.
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Phase 9.1: set when a later correction explicitly contradicts or
    // weakens the claim this evidence supported. Never deleted, never
    // rewritten in content — this only flags "no longer live" so
    // confidence rollups and evidence-inspection can distinguish
    // current support from preserved history. Null = still live.
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (table) => [
    index('personal_model_fact_evidence_fact_id_idx').on(table.factId),
    index('personal_model_fact_evidence_memory_id_idx').on(table.memoryId),
    index('personal_model_fact_evidence_user_id_idx').on(table.userId),
    // Postgres treats NULL as distinct for uniqueness, so this only
    // dedupes real memory-sourced rows — user_confirmation/correction/
    // dismissal rows (memoryId null) are never blocked by it, since
    // each such action is its own distinct event worth preserving.
    unique('personal_model_fact_evidence_fact_memory_unique').on(table.factId, table.memoryId),
    check('personal_model_fact_evidence_confidence_range', sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`),
  ],
);

/**
 * A versioned, point-in-time capture of the current fact set — written
 * only when an explicit rebuild runs (never on every read/tiny
 * operation, per item 11), so this table grows in bounded, deliberate
 * steps rather than per-request. `factsJson` is a COMPACT projection
 * (id/category/subjectKey/factText/epistemicStatus/confidence/
 * stability/temporalState per fact) — not a dump of memories/evidence,
 * which stay queryable via their own tables.
 */
export const personalModelSnapshots = pgTable(
  'personal_model_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    factsJson: jsonb('facts_json').notNull(),
    factCount: integer('fact_count').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('personal_model_snapshots_user_id_idx').on(table.userId),
    unique('personal_model_snapshots_user_version_unique').on(table.userId, table.version),
  ],
);

/**
 * Structured change-log entries — the concrete, evidence-tied record
 * of what changed between two rebuilds (or via a user action), meant
 * to power future Twin Evolution/Insights work. changeType is free
 * text; see modules/personalModel/changeLog.ts for the taxonomy this
 * phase actually emits.
 */
export const personalModelChanges = pgTable(
  'personal_model_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    factId: uuid('fact_id').references(() => personalModelFacts.id, { onDelete: 'set null' }),
    snapshotId: uuid('snapshot_id').references(() => personalModelSnapshots.id, { onDelete: 'set null' }),
    changeType: text('change_type').notNull(),
    description: text('description').notNull(),
    evidenceMemoryIds: jsonb('evidence_memory_ids').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('personal_model_changes_user_id_idx').on(table.userId),
    index('personal_model_changes_fact_id_idx').on(table.factId),
  ],
);
