import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

// Hand-maintained mirror of the relevant slice of home's own
// server/db/schema/tenant.ts - these tables are owned and migrated by home
// (see docs/architecture/ADR/0008-shared-multi-tenant-database.md and
// home's ADR-0008), never by flow-engine. Keep this in sync by hand if that
// schema changes.

export const flowJobs = pgTable('flow_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type', { enum: ['run', 'resume'] }).notNull(),
  graphId: uuid('graph_id').notNull(),
  userId: uuid('user_id').notNull(),
  runId: uuid('run_id'),
  input: jsonb('input'),
  status: text('status', {
    enum: ['pending', 'running', 'waiting', 'completed', 'failed'],
  })
    .notNull()
    .default('pending'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export interface InboxTaskFieldRow {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'messages';
  required: boolean;
  helpText?: string;
}

export const inboxTasks = pgTable('inbox_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull(),
  nodeId: text('node_id').notNull(),
  assigneeUserId: uuid('assignee_user_id').notNull(),
  prompt: text('prompt').notNull(),
  fields: jsonb('fields').$type<InboxTaskFieldRow[]>().notNull(),
  status: text('status', { enum: ['pending', 'completed'] }).notNull().default('pending'),
  input: jsonb('input'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});
