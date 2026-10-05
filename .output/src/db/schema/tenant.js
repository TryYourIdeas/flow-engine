"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inboxTasks = exports.flowJobs = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
exports.flowJobs = (0, pg_core_1.pgTable)('flow_jobs', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    type: (0, pg_core_1.text)('type', { enum: ['run', 'resume'] }).notNull(),
    graphId: (0, pg_core_1.uuid)('graph_id').notNull(),
    userId: (0, pg_core_1.uuid)('user_id').notNull(),
    runId: (0, pg_core_1.uuid)('run_id'),
    input: (0, pg_core_1.jsonb)('input'),
    status: (0, pg_core_1.text)('status', {
        enum: ['pending', 'running', 'waiting', 'completed', 'failed'],
    })
        .notNull()
        .default('pending'),
    error: (0, pg_core_1.text)('error'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
exports.inboxTasks = (0, pg_core_1.pgTable)('inbox_tasks', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    runId: (0, pg_core_1.uuid)('run_id').notNull(),
    nodeId: (0, pg_core_1.text)('node_id').notNull(),
    assigneeUserId: (0, pg_core_1.uuid)('assignee_user_id').notNull(),
    prompt: (0, pg_core_1.text)('prompt').notNull(),
    fields: (0, pg_core_1.jsonb)('fields').$type().notNull(),
    status: (0, pg_core_1.text)('status', { enum: ['pending', 'completed'] }).notNull().default('pending'),
    input: (0, pg_core_1.jsonb)('input'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: (0, pg_core_1.timestamp)('completed_at', { withTimezone: true }),
});
//# sourceMappingURL=tenant.js.map