import { pgTable, uuid, text, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { memories } from './memories.js';
import { entities } from './entities.js';

/**
 * Links a memory to the people/projects/goals/decisions/ideas/events
 * it's about — many-to-many. One memory can reference several
 * entities; one entity can be referenced by many memories.
 */
export const memoryEntities = pgTable(
  'memory_entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memoryId: uuid('memory_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    // e.g. "about", "mentions", "reported_by", "participant" — open
    // vocabulary, not a DB enum.
    role: text('role').notNull().default('related'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('memory_entities_entity_id_idx').on(table.entityId),
    unique('memory_entities_memory_entity_role_unique').on(table.memoryId, table.entityId, table.role),
  ],
);
