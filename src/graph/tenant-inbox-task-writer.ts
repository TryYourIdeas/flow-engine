import type { TenantDbFactory } from '../db/tenantDb';
import { inboxTasks } from '../db/schema/tenant';
import type { InboxTask, InboxTaskPort } from './inbox-task.port';

/**
 * Real InboxTaskPort implementation. Possible now that flow-engine already
 * holds a tenant-scoped connection for job claiming (see
 * docs/architecture/ADR/0005-shared-multi-tenant-database.md) - a paused
 * form node's inbox task is just another row in that same tenant schema,
 * no separate cross-database credential model needed.
 */
export class TenantInboxTaskWriter implements InboxTaskPort {
  constructor(private readonly tenantDbFactory: TenantDbFactory) {}

  async createTask(task: InboxTask): Promise<void> {
    const db = this.tenantDbFactory.getTenantDb(task.schemaName);
    await db.insert(inboxTasks).values({
      runId: task.runId,
      nodeId: task.nodeId,
      assigneeUserId: task.assigneeUserId,
      prompt: task.prompt,
      fields: task.fields,
    });
  }
}
