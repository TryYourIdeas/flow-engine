import { Injectable } from '@nestjs/common';
import { JobClaimService } from '../jobs/job-claim.service';
import { WorkerRunnerService } from '../worker/worker-runner.service';
import { ProgressPublisherService } from '../progress/progress-publisher.service';
import type { InboxTaskPort } from '../graph/inbox-task.port';
import type { ClaimedJob } from '../jobs/job.types';
import type {
  RunJobInput,
  ResumeJobInput,
  WorkerData,
  WorkerMessage,
} from '../worker/worker-messages.types';

@Injectable()
export class ExecutionOrchestratorService {
  constructor(
    private readonly jobClaimService: JobClaimService,
    private readonly workerRunnerService: WorkerRunnerService,
    private readonly progressPublisherService: ProgressPublisherService,
    private readonly inboxTaskWriter: InboxTaskPort,
  ) {}

  /** Claims and fully runs one pending job. Returns false if none was pending. */
  async processNext(): Promise<boolean> {
    const job = await this.jobClaimService.claimNext();
    if (!job) return false;

    const runId = job.runId ?? job.id;
    const workerInput = this.buildWorkerInput(job, runId);

    let alreadyResolved = false;

    try {
      for await (const message of this.workerRunnerService.run(workerInput)) {
        await this.progressPublisherService.publish(job.id, message);

        if (message.kind === 'error') {
          alreadyResolved = true;
          await this.jobClaimService.fail(job.id, message.message);
          return true;
        }

        if (message.kind === 'waiting_for_input') {
          alreadyResolved = true;
          await this.inboxTaskWriter.createTask({
            tenantId: job.tenantId,
            runId,
            nodeId: message.nodeId,
            prompt: message.prompt,
            fields: message.fields,
            assigneeUserId: this.resolveAssignee(message, job),
          });
          await this.jobClaimService.markWaiting(job.id, runId);
          return true;
        }
      }
      await this.jobClaimService.complete(job.id);
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
      await this.jobClaimService.fail(job.id, errorMessage);
    }

    return true;
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

  private buildWorkerInput(job: ClaimedJob, runId: string): WorkerData {
    if (job.type === 'run') {
      const { definition, input } = job.input as RunJobInput;
      return { kind: 'start', runId, definition, input };
    }
    const { definition, resumeValues } = job.input as ResumeJobInput;
    return { kind: 'resume', runId, definition, resumeValues };
  }
}
