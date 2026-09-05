import { pgTable, uuid, text, timestamp, jsonb, pgEnum, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * The shared supertype for every "node" in Twin's personal knowledge
 * graph — people, projects, goals, decisions, ideas, and events all
 * get a row here. Concrete types that need structured fields beyond
 * name/description (people, projects, goals, decisions, events)
 * extend this via a 1:1 subtype table keyed on `entity_id` — the
 * class-table-inheritance pattern. Every relationship (memory_entities,
 * entity_relationships) joins against this single stable id regardless
 * of concrete type, instead of needing a polymorphic foreign key.
 *
 * `idea` entities currently have no subtype table — name + description
 * here is enough to represent one. Give ideas a subtype table if/when
 * they need structured fields of their own.
 */
export const entityTypeEnum = pgEnum('entity_type', [
  'person',
  'project',
  'goal',
  'decision',
  'idea',
  'event',
]);

export const entities = pgTable(
  'entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entityType: entityTypeEnum('entity_type').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    metadata: jsonb('metadata').notNull().default({}),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('entities_user_id_idx').on(table.userId),
    index('entities_user_id_entity_type_idx').on(table.userId, table.entityType),
  ],
);
