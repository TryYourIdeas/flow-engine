import { Injectable } from '@nestjs/common';
import { JobClaimService } from '../jobs/job-claim.service';
import { WorkerRunnerService } from '../worker/worker-runner.service';
import { ProgressPublisherService } from '../progress/progress-publisher.service';
import type { GraphDefinition } from '../graph/graph-definition.types';

interface RunJobInput {
  definition: GraphDefinition;
  input: { input: string };
}

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

    const runInput = job.input as RunJobInput;

    try {
      for await (const message of this.workerRunnerService.run({
        definition: runInput.definition,
        input: runInput.input,
      })) {
        await this.progressPublisherService.publish(job.id, message);
        if (message.kind === 'error') {
          await this.jobClaimService.fail(job.id, message.message);
          return true;
        }
      }
      await this.jobClaimService.complete(job.id);
    } catch (err) {
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
