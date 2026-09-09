"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantInboxTaskWriter = void 0;
const tenant_1 = require("../db/schema/tenant");
class TenantInboxTaskWriter {
    tenantDbFactory;
    constructor(tenantDbFactory) {
        this.tenantDbFactory = tenantDbFactory;
    }
    async createTask(task) {
        const db = this.tenantDbFactory.getTenantDb(task.schemaName);
        await db.insert(tenant_1.inboxTasks).values({
            runId: task.runId,
            nodeId: task.nodeId,
            assigneeUserId: task.assigneeUserId,
            prompt: task.prompt,
            fields: task.fields,
        });
    }
}
exports.TenantInboxTaskWriter = TenantInboxTaskWriter;
//# sourceMappingURL=tenant-inbox-task-writer.js.map