import { ExecutionOrchestratorService } from './execution-orchestrator.service';
import { JobClaimService } from '../jobs/job-claim.service';
import { WorkerRunnerService } from '../worker/worker-runner.service';
import { ProgressPublisherService } from '../progress/progress-publisher.service';
import { testDb, seedJob, clearJobs } from '../db/test/seed';
import { jobs } from '../db/schema/public';
import { eq } from 'drizzle-orm';
import { Client } from 'pg';

describe('ExecutionOrchestratorService', () => {
  const { db, pool } = testDb();
  const jobClaimService = new JobClaimService(db);
  const workerRunnerService = new WorkerRunnerService();
  const progressPublisherService = new ProgressPublisherService(pool);
  const orchestrator = new ExecutionOrchestratorService(
    jobClaimService,
    workerRunnerService,
    progressPublisherService,
  );

  afterEach(async () => {
    await clearJobs(db);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('claims a job, publishes token events, and marks it completed', async () => {
    const seeded = await seedJob(db, {
      input: {
        definition: {
          entryNodeId: 'llm-1',
          nodes: [
            {
              id: 'llm-1',
              type: 'llm',
              data: {
                systemPrompt: 'test',
                provider: 'anthropic',
                model: 'claude-test',
                temperature: 0.5,
              },
            },
          ],
          edges: [],
        },
        input: { input: 'hi' },
      },
    });

    const listener = new Client({
      connectionString:
        process.env.DATABASE_URL ??
        'postgres://flow_engine:flow_engine@localhost:5433/flow_engine',
    });
    await listener.connect();
    await listener.query(`LISTEN "run:${seeded.id}"`);
    const receivedTokens: string[] = [];
    listener.on('notification', (msg) => {
      const event = JSON.parse(msg.payload ?? '{}');
      if (event.kind === 'token') receivedTokens.push(event.token);
    });

    const ran = await orchestrator.processNext();
    expect(ran).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(receivedTokens.length).toBeGreaterThan(0);

    const [row] = await db.select().from(jobs).where(eq(jobs.id, seeded.id));
    expect(row.status).toBe('completed');

    await listener.end();
  }, 15000);

  it('returns false when there is no pending job', async () => {
    const ran = await orchestrator.processNext();
    expect(ran).toBe(false);
  });
});
