"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionOrchestratorService = void 0;
const common_1 = require("@nestjs/common");
const job_claim_service_1 = require("../jobs/job-claim.service");
const worker_runner_service_1 = require("../worker/worker-runner.service");
const progress_publisher_service_1 = require("../progress/progress-publisher.service");
const tenant_registry_service_1 = require("../tenants/tenant-registry.service");
const tenant_inbox_task_writer_1 = require("../graph/tenant-inbox-task-writer");
let ExecutionOrchestratorService = class ExecutionOrchestratorService {
    tenantRegistry;
    jobClaimService;
    workerRunnerService;
    progressPublisherService;
    inboxTaskWriter;
    cursor = 0;
    constructor(tenantRegistry, jobClaimService, workerRunnerService, progressPublisherService, inboxTaskWriter) {
        this.tenantRegistry = tenantRegistry;
        this.jobClaimService = jobClaimService;
        this.workerRunnerService = workerRunnerService;
        this.progressPublisherService = progressPublisherService;
        this.inboxTaskWriter = inboxTaskWriter;
    }
    async processNext() {
        const schemas = await this.tenantRegistry.listTenantSchemas();
        if (schemas.length === 0)
            return false;
        for (let offset = 0; offset < schemas.length; offset++) {
            const index = (this.cursor + offset) % schemas.length;
            const schemaName = schemas[index];
            const job = await this.jobClaimService.claimNext(schemaName);
            if (job) {
                this.cursor = (index + 1) % schemas.length;
                await this.processJob(job);
                return true;
            }
        }
        return false;
    }
    async processJob(job) {
        const workerInput = this.buildWorkerInput(job);
        let alreadyResolved = false;
        try {
            for await (const message of this.workerRunnerService.run(workerInput)) {
                await this.progressPublisherService.publish(job.id, message);
                if (message.kind === 'error') {
                    alreadyResolved = true;
                    await this.jobClaimService.fail(job.schemaName, job.id, message.message);
                    return;
                }
                if (message.kind === 'waiting_for_input') {
                    alreadyResolved = true;
                    await this.inboxTaskWriter.createTask({
                        schemaName: job.schemaName,
                        runId: job.runId ?? job.id,
                        nodeId: message.nodeId,
                        prompt: message.prompt,
                        fields: message.fields,
                        assigneeUserId: this.resolveAssignee(message, job),
                    });
                    await this.jobClaimService.markWaiting(job.schemaName, job.id, job.runId ?? job.id);
                    return;
                }
            }
            await this.jobClaimService.complete(job.schemaName, job.id);
        }
        catch (err) {
            if (alreadyResolved) {
                throw err;
            }
            const errorMessage = err instanceof Error ? err.message : String(err);
            await this.progressPublisherService.publish(job.id, {
                kind: 'error',
                message: errorMessage,
            });
            await this.jobClaimService.fail(job.schemaName, job.id, errorMessage);
        }
    }
    resolveAssignee(message, job) {
        if (message.assigneeMode === 'specific_user') {
            if (!message.assigneeUserId) {
                throw new Error(`form node '${message.nodeId}' is assigneeMode 'specific_user' but has no assigneeUserId`);
            }
            return message.assigneeUserId;
        }
        return job.userId;
    }
    buildWorkerInput(job) {
        const runId = job.runId ?? job.id;
        if (job.type === 'run') {
            const { definition, input } = job.input;
            return { kind: 'start', runId, schemaName: job.schemaName, definition, input };
        }
        const { definition, resumeValues } = job.input;
        return { kind: 'resume', runId, schemaName: job.schemaName, definition, resumeValues };
    }
};
exports.ExecutionOrchestratorService = ExecutionOrchestratorService;
exports.ExecutionOrchestratorService = ExecutionOrchestratorService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [tenant_registry_service_1.TenantRegistryService,
        job_claim_service_1.JobClaimService,
        worker_runner_service_1.WorkerRunnerService,
        progress_publisher_service_1.ProgressPublisherService,
        tenant_inbox_task_writer_1.TenantInboxTaskWriter])
], ExecutionOrchestratorService);
//# sourceMappingURL=execution-orchestrator.service.js.map