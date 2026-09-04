import {
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { createDb } from './db/client';
import { TenantDbFactory } from './db/tenantDb';
import { TenantRegistryService } from './tenants/tenant-registry.service';
import { JobClaimService } from './jobs/job-claim.service';
import { WorkerRunnerService } from './worker/worker-runner.service';
import { ProgressPublisherService } from './progress/progress-publisher.service';
import { TenantInboxTaskWriter } from './graph/tenant-inbox-task-writer';
import { ExecutionOrchestratorService } from './orchestrator/execution-orchestrator.service';

// The same Postgres instance/database home uses (per home's
// docs/architecture/ADR/0008-shared-multi-tenant-database-for-flow-engine.md)
// - `db`/`pool` here are only used for the public.tenants registry and
// pg_notify progress publishing; all job/inbox_tasks reads and writes go
// through TenantDbFactory's per-tenant-schema connections instead.
const connectionString =
  process.env.DATABASE_URL ??
  'postgres://flow_engine:flow_engine@localhost:5433/flow_engine';
const { db, pool } = createDb(connectionString);
const tenantDbFactory = new TenantDbFactory(connectionString);

@Module({
  providers: [
    {
      provide: TenantRegistryService,
      useFactory: () => new TenantRegistryService(db),
    },
    {
      provide: JobClaimService,
      useFactory: () => new JobClaimService(tenantDbFactory),
    },
    WorkerRunnerService,
    {
      provide: ProgressPublisherService,
      useFactory: () => new ProgressPublisherService(pool),
    },
    {
      provide: TenantInboxTaskWriter,
      useFactory: () => new TenantInboxTaskWriter(tenantDbFactory),
    },
    ExecutionOrchestratorService,
  ],
})
export class AppModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AppModule.name);
  private stopping = false;

  constructor(private readonly orchestrator: ExecutionOrchestratorService) {}

  onModuleInit() {
    this.pollLoop();
  }

  async onModuleDestroy() {
    this.stopping = true;
    await pool.end();
    await tenantDbFactory.closeAll();
  }

  private async pollLoop() {
    while (!this.stopping) {
      let ran = false;
      try {
        ran = await this.orchestrator.processNext();
      } catch (err) {
        this.logger.error(
          `poll loop iteration failed: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err.stack : undefined,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, ran ? 0 : 1000));
    }
  }
}
