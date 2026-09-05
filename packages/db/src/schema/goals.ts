import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { entities } from './entities.js';

/**
 * 1:1 subtype of `entities` for entity_type = 'goal'.
 * `status` is a free-text convention (active | achieved | abandoned).
 */
export const goals = pgTable('goals', {
  entityId: uuid('entity_id')
    .primaryKey()
    .references(() => entities.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('active'),
  targetDate: timestamp('target_date', { withTimezone: true }),
  achievedAt: timestamp('achieved_at', { withTimezone: true }),
});
