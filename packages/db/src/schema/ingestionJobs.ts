import { pgTable, uuid, text, timestamp, jsonb, boolean, pgEnum, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { memories } from './memories.js';

/**
 * What kind of raw input was submitted. `voice_transcript` assumes
 * speech-to-text already happened client-side (or upstream) — this
 * pipeline does not perform STT itself. `image`/`document` have no
 * OCR/document-parsing implemented yet; see ingestion.service.ts for
 * exactly what's real per type.
 */
export const ingestionInputTypeEnum = pgEnum('ingestion_input_type', [
  'text',
  'image',
  'document',
  'voice_transcript',
  'web_link',
]);

/**
 * A real, stored state machine — not just a status label. Every
 * transition a job goes through is appended to `status_history` as it
 * happens (see ingestion.service.ts), so the full pending → processing
 * → completed/failed lifecycle is verifiable after the fact even
 * though processing currently runs synchronously within the request
 * that created the job (no background worker yet).
 */
export const ingestionStatusEnum = pgEnum('ingestion_status', [
  'pending',
  'processing',
  'completed',
  'failed',
]);

export const ingestionJobs = pgTable(
  'ingestion_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    inputType: ingestionInputTypeEnum('input_type').notNull(),
    status: ingestionStatusEnum('status').notNull().default('pending'),
    // Array of { status, at } entries, appended on every transition.
    statusHistory: jsonb('status_history').notNull().default([]),
    // The raw submitted payload (content/url/description/etc), kept
    // verbatim for debugging and any future reprocessing.
    rawInput: jsonb('raw_input').notNull(),
    // Which extraction provider handled this job, e.g. "heuristic-v1",
    // "web-fetch-v1" — an audit trail for when multiple providers exist.
    extractionProvider: text('extraction_provider').notNull(),
    isDuplicate: boolean('is_duplicate').notNull().default(false),
    // Set null (not cascaded) if the resulting memory is later deleted —
    // the ingestion job's history is a record of what happened, not a
    // reference that should vanish with its output.
    resultMemoryId: uuid('result_memory_id').references(() => memories.id, { onDelete: 'set null' }),
    // Audit trail for the optional AI extraction stage (Phase 5): which
    // provider ran, what it produced after validation/entity resolution,
    // or why it failed. Null whenever no AI provider was configured —
    // distinct from "AI ran and found nothing" (an empty-but-present
    // result), so the two cases are never confused when read back later.
    extractionResult: jsonb('extraction_result'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('ingestion_jobs_user_id_idx').on(table.userId),
    index('ingestion_jobs_user_id_status_idx').on(table.userId, table.status),
  ],
);
