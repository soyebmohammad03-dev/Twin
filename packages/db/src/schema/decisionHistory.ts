import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { entities } from './entities.js';

/**
 * Phase 36 — an append-only audit trail of a decision's real state
 * transitions (status/outcome/decidedAt), captured by
 * decisions.service.ts's updateDecision whenever a PATCH actually
 * changes one of those fields. This directly answers "how did this
 * decision change over time?", which the `decisions` table alone
 * cannot: it only ever holds the CURRENT status/outcome/decidedAt, so
 * marking a decision reversed (or editing its outcome) previously
 * discarded whatever it used to be.
 *
 * Every row here records something that genuinely happened (the
 * user's own explicit action moving status/outcome from A to B) — it
 * is never inferred, never backfilled, and never created for the
 * decision's initial creation (that moment is already the entity's own
 * createdAt; this table only exists to prevent LATER changes from
 * being silently lost).
 */
export const decisionHistory = pgTable(
  'decision_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    previousStatus: text('previous_status').notNull(),
    newStatus: text('new_status').notNull(),
    previousOutcome: text('previous_outcome'),
    newOutcome: text('new_outcome'),
    previousDecidedAt: timestamp('previous_decided_at', { withTimezone: true }),
    newDecidedAt: timestamp('new_decided_at', { withTimezone: true }),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('decision_history_entity_id_changed_at_idx').on(table.entityId, table.changedAt),
  ],
);
