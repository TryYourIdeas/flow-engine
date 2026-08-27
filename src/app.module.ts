import { Module, type OnModuleInit } from '@nestjs/common';
import { createDb } from './db/client';
import { JobClaimService } from './jobs/job-claim.service';
import { WorkerRunnerService } from './worker/worker-runner.service';
import { ProgressPublisherService } from './progress/progress-publisher.service';
import { ExecutionOrchestratorService } from './orchestrator/execution-orchestrator.service';

const { db, pool } = createDb(
  process.env.DATABASE_URL ??
    'postgres://flow_engine:flow_engine@localhost:5433/flow_engine',
);

@Module({
  providers: [
    { provide: 'DB', useValue: db },
    { provide: 'PG_POOL', useValue: pool },
    {
      provide: JobClaimService,
      useFactory: () => new JobClaimService(db),
    },
    WorkerRunnerService,
    {
      provide: ProgressPublisherService,
      useFactory: () => new ProgressPublisherService(pool),
    },
    ExecutionOrchestratorService,
  ],
})
export class AppModule implements OnModuleInit {
  constructor(private readonly orchestrator: ExecutionOrchestratorService) {}

  onModuleInit() {
    this.pollLoop();
  }

  private async pollLoop() {
    while (true) {
      const ran = await this.orchestrator.processNext();
      await new Promise((resolve) => setTimeout(resolve, ran ? 0 : 1000));
    }
  }
}
