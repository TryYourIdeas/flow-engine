import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type', { enum: ['run', 'resume'] }).notNull(),
  tenantId: text('tenant_id').notNull(),
  userId: text('user_id').notNull(),
  graphId: text('graph_id').notNull(),
  runId: uuid('run_id'),
  input: jsonb('input'),
  status: text('status', {
    enum: ['pending', 'running', 'completed', 'failed'],
  })
    .notNull()
    .default('pending'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
