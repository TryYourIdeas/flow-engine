import type { TenantDbFactory } from '../db/tenantDb';
import type { InboxTask, InboxTaskPort } from './inbox-task.port';
export declare class TenantInboxTaskWriter implements InboxTaskPort {
    private readonly tenantDbFactory;
    constructor(tenantDbFactory: TenantDbFactory);
    createTask(task: InboxTask): Promise<void>;
}
