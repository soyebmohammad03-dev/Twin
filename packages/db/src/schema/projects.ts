import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { entities } from './entities.js';

/**
 * 1:1 subtype of `entities` for entity_type = 'project'.
 * `status` is a free-text convention (active | paused | completed |
 * archived), not a DB enum — project lifecycles are likely to gain
 * nuance before this taxonomy is worth locking down.
 */
export const projects = pgTable('projects', {
  entityId: uuid('entity_id')
    .primaryKey()
    .references(() => entities.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('active'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});
