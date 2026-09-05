import { pgTable, uuid, text, jsonb } from 'drizzle-orm/pg-core';
import { entities } from './entities.js';

/**
 * 1:1 subtype of `entities` for entity_type = 'person'. The free-text
 * summary lives on the shared entities.description; this table only
 * holds fields specific to people.
 */
export const people = pgTable('people', {
  entityId: uuid('entity_id')
    .primaryKey()
    .references(() => entities.id, { onDelete: 'cascade' }),
  role: text('role'), // e.g. "Lead Engineer @ Quantum"
  relationship: text('relationship'), // e.g. "colleague", "friend", "family" — open vocabulary, not enforced
  contactInfo: jsonb('contact_info').notNull().default({}),
});
