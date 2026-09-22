import type { TenantDbFactory } from '../db/tenantDb';
import type { ClaimedJob } from './job.types';
export declare class JobClaimService {
    private readonly tenantDbFactory;
    constructor(tenantDbFactory: TenantDbFactory);
    claimNext(schemaName: string): Promise<ClaimedJob | null>;
    complete(schemaName: string, jobId: string): Promise<void>;
    fail(schemaName: string, jobId: string, error: string): Promise<void>;
    markWaiting(schemaName: string, jobId: string, runId: string): Promise<void>;
}
