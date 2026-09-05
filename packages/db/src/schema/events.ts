import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { entities } from './entities.js';

/**
 * 1:1 subtype of `entities` for entity_type = 'event'. Distinct from a
 * memory's `occurred_at`: an event is a nameable, referenceable
 * happening (e.g. "Q3 Board Meeting") that multiple memories can be
 * about, not just a timestamp on one memory row.
 */
export const events = pgTable('events', {
  entityId: uuid('entity_id')
    .primaryKey()
    .references(() => entities.id, { onDelete: 'cascade' }),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  location: text('location'),
});
