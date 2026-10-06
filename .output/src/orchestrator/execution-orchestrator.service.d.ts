import { JobClaimService } from '../jobs/job-claim.service';
import { WorkerRunnerService } from '../worker/worker-runner.service';
import { ProgressPublisherService } from '../progress/progress-publisher.service';
import { TenantRegistryService } from '../tenants/tenant-registry.service';
import { TenantInboxTaskWriter } from '../graph/tenant-inbox-task-writer';
export declare class ExecutionOrchestratorService {
    private readonly tenantRegistry;
    private readonly jobClaimService;
    private readonly workerRunnerService;
    private readonly progressPublisherService;
    private readonly inboxTaskWriter;
    private cursor;
    constructor(tenantRegistry: TenantRegistryService, jobClaimService: JobClaimService, workerRunnerService: WorkerRunnerService, progressPublisherService: ProgressPublisherService, inboxTaskWriter: TenantInboxTaskWriter);
    processNext(): Promise<boolean>;
    private processJob;
    private resolveAssignee;
    private buildWorkerInput;
}
