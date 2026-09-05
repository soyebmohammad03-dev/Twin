import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The root identity table. Every other table in the system will carry
 * a `user_id` foreign key back to this table — that convention is the
 * foundation of per-user data isolation (see docs/architecture.md).
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name').notNull(),
  displayName: text('display_name').notNull(),
  handle: text('handle').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
