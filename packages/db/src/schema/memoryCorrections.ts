import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { memories } from './memories.js';

/**
 * Phase 38 — an append-only record of a memory's real content
 * corrections, captured by memories.service.ts's updateMemory whenever
 * a PATCH actually changes `content`. Before this, correcting a
 * memory's content silently overwrote it in place — the exact text
 * Twin used to believe was gone with no trace, even though the
 * memory's source/provenance columns (sourceId, epistemicStatus,
 * createdAt) never changed and kept implying nothing had been edited.
 *
 * Every row here is a genuine, user-triggered PATCH that changed
 * `content` — never inferred, never backfilled, and never written for
 * the memory's initial creation (that moment is already the memory's
 * own createdAt). Scoped to `content` only, not every mutable field:
 * content is the actual remembered fact; memoryType/importance/
 * metadata are classification, not knowledge, so editing them isn't a
 * "correction" in the sense this table exists to preserve.
 */
export const memoryCorrections = pgTable(
  'memory_corrections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memoryId: uuid('memory_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    previousContent: text('previous_content').notNull(),
    newContent: text('new_content').notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('memory_corrections_memory_id_changed_at_idx').on(table.memoryId, table.changedAt),
    index('memory_corrections_user_id_idx').on(table.userId),
  ],
);
