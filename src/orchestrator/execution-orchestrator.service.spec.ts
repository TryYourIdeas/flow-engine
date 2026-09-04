import { ExecutionOrchestratorService } from './execution-orchestrator.service';
import { JobClaimService } from '../jobs/job-claim.service';
import { WorkerRunnerService } from '../worker/worker-runner.service';
import { ProgressPublisherService } from '../progress/progress-publisher.service';
import { FakeInboxTaskWriter } from '../graph/fake-inbox-task-writer';
import { testDb, seedJob, clearJobs } from '../db/test/seed';
import { jobs } from '../db/schema/public';
import { eq } from 'drizzle-orm';
import { Client } from 'pg';

describe('ExecutionOrchestratorService', () => {
  const { db, pool } = testDb();
  const jobClaimService = new JobClaimService(db);
  const workerRunnerService = new WorkerRunnerService();
  const progressPublisherService = new ProgressPublisherService(pool);
  const inboxTaskWriter = new FakeInboxTaskWriter();
  const orchestrator = new ExecutionOrchestratorService(
    jobClaimService,
    workerRunnerService,
    progressPublisherService,
    inboxTaskWriter,
  );

  afterEach(async () => {
    await clearJobs(db);
    inboxTaskWriter.tasks.length = 0;
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
          stateSchema: { fields: [] },
        },
        input: { input: 'hi' },
      },
    });

    const listener = new Client({
      connectionString:
        process.env.DATABASE_URL ??
        'postgres://flow_engine:flow_engine@localhost:5433/flow_engine',
    });
    listener.on('error', (err) => {
      console.error('test LISTEN client error:', err);
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

  it('fails the job exactly once when the worker emits a kind:error message', async () => {
    const seeded = await seedJob(db, {
      input: {
        definition: {
          entryNodeId: 'llm-1',
          nodes: [],
          edges: [],
          stateSchema: { fields: [] },
        },
        input: { input: 'hi' },
      },
    });

    const ran = await orchestrator.processNext();
    expect(ran).toBe(true);

    const [row] = await db.select().from(jobs).where(eq(jobs.id, seeded.id));
    expect(row.status).toBe('failed');
    expect(row.error).toContain("Unknown entryNodeId 'llm-1'");
  }, 15000);

  it('writes an inbox task and marks the job waiting when a form node interrupts', async () => {
    const seeded = await seedJob(db, {
      userId: 'launcher-1',
      tenantId: 'tenant-9',
      input: {
        definition: {
          entryNodeId: 'form-1',
          nodes: [
            {
              id: 'form-1',
              type: 'form',
              data: {
                label: 'Approval',
                prompt: 'Approve?',
                assigneeMode: 'launcher',
                fields: [
                  { key: 'approved', label: 'Approved?', type: 'boolean', required: true },
                ],
              },
            },
          ],
          edges: [],
          stateSchema: { fields: [{ key: 'approved', type: 'boolean' }] },
        },
        input: { input: 'hi' },
      },
    });

    const ran = await orchestrator.processNext();
    expect(ran).toBe(true);

    expect(inboxTaskWriter.tasks).toHaveLength(1);
    expect(inboxTaskWriter.tasks[0]).toMatchObject({
      tenantId: 'tenant-9',
      nodeId: 'form-1',
      prompt: 'Approve?',
      assigneeUserId: 'launcher-1',
    });

    const [row] = await db.select().from(jobs).where(eq(jobs.id, seeded.id));
    expect(row.status).toBe('waiting');
    expect(row.runId).toBe(inboxTaskWriter.tasks[0].runId);
  }, 15000);

  it('processes a resume job by loading the checkpoint and continuing', async () => {
    const definition = {
      entryNodeId: 'form-1',
      nodes: [
        {
          id: 'form-1',
          type: 'form',
          data: {
            label: 'Approval',
            prompt: 'Approve?',
            assigneeMode: 'launcher',
            fields: [
              { key: 'approved', label: 'Approved?', type: 'boolean', required: true },
            ],
          },
        },
        {
          id: 'llm-1',
          type: 'llm',
          data: {
            systemPrompt: 'continue',
            provider: 'anthropic',
            model: 'claude-test',
            temperature: 0.5,
          },
        },
      ],
      edges: [{ source: 'form-1', target: 'llm-1' }],
      stateSchema: { fields: [{ key: 'approved', type: 'boolean' }] },
    };

    await seedJob(db, {
      input: { definition, input: { input: 'hi' } },
    });
    await orchestrator.processNext();
    const runId = inboxTaskWriter.tasks[0].runId;

    const resumed = await seedJob(db, {
      type: 'resume',
      runId,
      input: { definition, resumeValues: { approved: true } },
    });

    const ran = await orchestrator.processNext();
    expect(ran).toBe(true);

    const [row] = await db.select().from(jobs).where(eq(jobs.id, resumed.id));
    expect(row.status).toBe('completed');
  }, 15000);
});
