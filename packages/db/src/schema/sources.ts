import { pgTable, uuid, text, timestamp, jsonb, pgEnum, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * How a piece of content entered Twin. Every memory traces back to
 * exactly one source; a single source can back multiple memories
 * (e.g. five facts extracted from one uploaded document). This is
 * deliberately separate from a memory's `epistemic_status`: a source
 * is the concrete origin artifact, epistemic_status is the kind of
 * epistemic claim Twin is making about the resulting memory.
 */
export const sourceTypeEnum = pgEnum('source_type', [
  'manual',
  'voice_note',
  'document',
  'image',
  'screen_capture',
  'conversation',
  'web_link',
  'system_synthesis',
]);

export const sources = pgTable(
  'sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceType: sourceTypeEnum('source_type').notNull(),
    title: text('title'),
    rawContent: text('raw_content'), // original captured text/transcript, before distillation into memory content
    url: text('url'), // web link or future object-storage reference
    capturedAt: timestamp('captured_at', { withTimezone: true }), // when the raw capture happened, if known and different from createdAt
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('sources_user_id_idx').on(table.userId),
    index('sources_user_id_source_type_idx').on(table.userId, table.sourceType),
  ],
);
