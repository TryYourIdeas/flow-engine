import { Injectable } from '@nestjs/common';
import { JobClaimService } from '../jobs/job-claim.service';
import { WorkerRunnerService } from '../worker/worker-runner.service';
import { ProgressPublisherService } from '../progress/progress-publisher.service';
import { TenantRegistryService } from '../tenants/tenant-registry.service';
import { TenantInboxTaskWriter } from '../graph/tenant-inbox-task-writer';
import type { ClaimedJob } from '../jobs/job.types';
import type {
  RunJobInput,
  ResumeJobInput,
  WorkerData,
  WorkerMessage,
} from '../worker/worker-messages.types';

@Injectable()
export class ExecutionOrchestratorService {
  private cursor = 0;

  constructor(
    private readonly tenantRegistry: TenantRegistryService,
    private readonly jobClaimService: JobClaimService,
    private readonly workerRunnerService: WorkerRunnerService,
    private readonly progressPublisherService: ProgressPublisherService,
    private readonly inboxTaskWriter: TenantInboxTaskWriter,
  ) {}

  /**
   * Claims and fully runs one pending job from whichever tenant schema has
   * one, round-robining across tenants (starting from the schema after the
   * one that yielded work last time) so no single tenant can starve the
   * others under sustained load. Returns false if no tenant had a pending
   * job.
   */
  async processNext(): Promise<boolean> {
    const schemas = await this.tenantRegistry.listTenantSchemas();
    if (schemas.length === 0) return false;

    for (let offset = 0; offset < schemas.length; offset++) {
      const index = (this.cursor + offset) % schemas.length;
      const schemaName = schemas[index]!;
      const job = await this.jobClaimService.claimNext(schemaName);
      if (job) {
        this.cursor = (index + 1) % schemas.length;
        await this.processJob(job);
        return true;
      }
    }

    return false;
  }

  private async processJob(job: ClaimedJob): Promise<void> {
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
    } catch (err) {
      if (alreadyResolved) {
        // The job already reached a terminal outcome above; jobClaimService
        // itself is what threw here. Don't publish a second NOTIFY or
        // overwrite that outcome with this unrelated write error - surface
        // it by letting the promise reject.
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

  private resolveAssignee(
    message: Extract<WorkerMessage, { kind: 'waiting_for_input' }>,
    job: ClaimedJob,
  ): string {
    if (message.assigneeMode === 'specific_user') {
      if (!message.assigneeUserId) {
        throw new Error(
          `form node '${message.nodeId}' is assigneeMode 'specific_user' but has no assigneeUserId`,
        );
      }
      return message.assigneeUserId;
    }
    return job.userId;
  }

  private buildWorkerInput(job: ClaimedJob): WorkerData {
    const runId = job.runId ?? job.id;
    if (job.type === 'run') {
      const { definition, input } = job.input as RunJobInput;
      return { kind: 'start', runId, schemaName: job.schemaName, definition, input };
    }
    const { definition, resumeValues } = job.input as ResumeJobInput;
    return { kind: 'resume', runId, schemaName: job.schemaName, definition, resumeValues };
  }
}
