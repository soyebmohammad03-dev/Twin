import { pgTable, uuid, text, timestamp, numeric, integer, index, unique, check, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { entities } from './entities.js';
import { entityRelationships } from './entityRelationships.js';
import { memories } from './memories.js';
import { personalModelFacts } from './personalModel.js';

/**
 * Phase 10's Insight layer — cross-cutting, evidence-backed
 * observations about PATTERNS across a user's memories/entities/
 * relationships/Personal Model facts. Deliberately a separate
 * epistemic layer from personal_model_facts (see docs/architecture.md
 * and the Phase 10 plan): an insight is never written into
 * personal_model_facts, and personal_model_facts are never written
 * into insights — an insight can only be accepted (left as-is) or
 * dismissed, never "corrected" into a new fact.
 *
 * Same rollup-row + append-only-evidence-trail shape as
 * entity_relationships/relationship_evidence and
 * personal_model_facts/personal_model_fact_evidence — the third
 * instance of this pattern in the schema, not a new shape.
 */
export const insights = pgTable(
  'insights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Open, evolving taxonomy — kept as free text, matching
    // personal_model_facts.category's convention. This phase only
    // ever emits 'neglected_goal'; see modules/insights/categories.ts.
    insightType: text('insight_type').notNull(),
    // Stable dedup key within (userId, insightType) — e.g.
    // `<goalEntityId>` for a neglected_goal insight.
    subjectKey: text('subject_key').notNull(),
    // 'observed' | 'inferred' | 'hypothesis' | 'unresolved' — see modules/insights/categories.ts
    statusClass: text('status_class').notNull(),
    // 'emerging' | 'recurring' | 'stable' | 'fading' | 'superseded' | 'unresolved' — see modules/insights/temporal.ts
    temporalState: text('temporal_state').notNull(),
    // Short, templated, deterministic — never free-form invented prose (never LLM-authored this phase).
    title: text('title').notNull(),
    description: text('description').notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    // Set when the insight centers on one entity (e.g. the neglected goal itself).
    subjectEntityId: uuid('subject_entity_id').references(() => entities.id, { onDelete: 'set null' }),
    firstObservedAt: timestamp('first_observed_at', { withTimezone: true }).notNull(),
    lastObservedAt: timestamp('last_observed_at', { withTimezone: true }).notNull(),
    observationCount: integer('observation_count').notNull().default(1),
    // Soft — dismissing an insight hides it from the default view
    // without destroying its evidence trail, exactly like
    // personal_model_facts.dismissedAt.
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    // Set when temporalState = 'superseded': points at the insight
    // that replaced this one. Never a hard requirement — most
    // insights never get superseded.
    supersededByInsightId: uuid('superseded_by_insight_id').references((): AnyPgColumn => insights.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('insights_user_id_idx').on(table.userId),
    index('insights_user_id_insight_type_idx').on(table.userId, table.insightType),
    index('insights_subject_entity_id_idx').on(table.subjectEntityId),
    unique('insights_user_type_subject_unique').on(table.userId, table.insightType, table.subjectKey),
    check('insights_confidence_range', sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`),
  ],
);

/**
 * The full, append-only evidence trail behind an insight's rollup
 * fields — mirrors personal_model_fact_evidence, generalized with a
 * personalModelFactId pointer since insights are the first layer that
 * needs to cite a Personal Model fact as evidence for a pattern.
 */
export const insightEvidence = pgTable(
  'insight_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    insightId: uuid('insight_id')
      .notNull()
      .references(() => insights.id, { onDelete: 'cascade' }),
    // 'memory' | 'entity' | 'relationship' | 'personal_model_fact'
    evidenceType: text('evidence_type').notNull(),
    memoryId: uuid('memory_id').references(() => memories.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id').references(() => entities.id, { onDelete: 'set null' }),
    relationshipId: uuid('relationship_id').references(() => entityRelationships.id, { onDelete: 'set null' }),
    personalModelFactId: uuid('personal_model_fact_id').references(() => personalModelFacts.id, { onDelete: 'set null' }),
    // Phase 14: set only on 'insight'-type evidence rows belonging to a
    // 'cross_insight' — points at the CONTRIBUTING first-order insight
    // this synthesis cites. Self-reference into the same table (mirrors
    // insights.supersededByInsightId's existing self-reference).
    // set null (not cascade): if the contributing insight is later
    // hard-deleted (its own pattern stopped holding), this evidence row
    // survives with its already-captured evidenceText intact — only the
    // "drill down further" pointer is lost, same convention as
    // entityId/relationshipId/personalModelFactId above.
    sourceInsightId: uuid('source_insight_id').references((): AnyPgColumn => insights.id, { onDelete: 'set null' }),
    // The quoted/derived snippet this evidence row was matched from.
    evidenceText: text('evidence_text'),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Set when a later rebuild determines this evidence no longer
    // supports the insight's current state (e.g. the underlying
    // Personal Model fact was corrected) — reuses Phase 9.1's
    // supersededAt mechanic directly. Never deleted, never rewritten.
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (table) => [
    index('insight_evidence_insight_id_idx').on(table.insightId),
    index('insight_evidence_memory_id_idx').on(table.memoryId),
    index('insight_evidence_user_id_idx').on(table.userId),
    index('insight_evidence_source_insight_id_idx').on(table.sourceInsightId),
    // Postgres treats NULL as distinct for uniqueness, so this only
    // dedupes real memory-sourced rows — entity/relationship/
    // personal-model-fact evidence rows (memoryId null) are never
    // blocked by it.
    unique('insight_evidence_insight_memory_unique').on(table.insightId, table.memoryId),
  ],
);
