import { Injectable } from '@nestjs/common';
import { JobClaimService } from '../jobs/job-claim.service';
import { WorkerRunnerService } from '../worker/worker-runner.service';
import { ProgressPublisherService } from '../progress/progress-publisher.service';
import type { WorkerData } from '../worker/worker-messages.types';

@Injectable()
export class ExecutionOrchestratorService {
  constructor(
    private readonly jobClaimService: JobClaimService,
    private readonly workerRunnerService: WorkerRunnerService,
    private readonly progressPublisherService: ProgressPublisherService,
  ) {}

  /** Claims and fully runs one pending job. Returns false if none was pending. */
  async processNext(): Promise<boolean> {
    const job = await this.jobClaimService.claimNext();
    if (!job) return false;

    if (job.type !== 'run') {
      throw new Error(
        `ExecutionOrchestratorService only handles 'run' jobs in this plan; got '${job.type}'`,
      );
    }

    const runInput = job.input as WorkerData;

    // Set right before/after the in-loop fail() call so the catch block below
    // can tell "a worker-reported error was already recorded as failed" apart
    // from "something else (e.g. a transient DB error) blew up mid-run" and
    // avoid publishing/failing a second time for the same job in the former
    // case.
    let alreadyFailed = false;

    try {
      for await (const message of this.workerRunnerService.run({
        definition: runInput.definition,
        input: runInput.input,
      })) {
        await this.progressPublisherService.publish(job.id, message);
        if (message.kind === 'error') {
          alreadyFailed = true;
          await this.jobClaimService.fail(job.id, message.message);
          return true;
        }
      }
      await this.jobClaimService.complete(job.id);
    } catch (err) {
      if (alreadyFailed) {
        // The job is already terminally 'failed' with the worker's original
        // error message; jobClaimService.fail() itself is what threw here.
        // Don't publish a second NOTIFY or overwrite the failure with this
        // unrelated write error - surface it by letting the promise reject.
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
}
