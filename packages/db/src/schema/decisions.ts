import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { entities } from './entities.js';

/**
 * 1:1 subtype of `entities` for entity_type = 'decision'.
 * `status` is a free-text convention (open | decided | reversed).
 */
export const decisions = pgTable('decisions', {
  entityId: uuid('entity_id')
    .primaryKey()
    .references(() => entities.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('open'),
  outcome: text('outcome'), // the chosen outcome, once decided
  decidedAt: timestamp('decided_at', { withTimezone: true }),
});
