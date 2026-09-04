import { eq } from 'drizzle-orm';
import { Client } from 'pg';
import { ExecutionOrchestratorService } from './execution-orchestrator.service';
import { JobClaimService } from '../jobs/job-claim.service';
import { WorkerRunnerService } from '../worker/worker-runner.service';
import { ProgressPublisherService } from '../progress/progress-publisher.service';
import { TenantRegistryService } from '../tenants/tenant-registry.service';
import { TenantInboxTaskWriter } from '../graph/tenant-inbox-task-writer';
import {
  testDb,
  testTenantDbFactory,
  seedTenant,
  clearTenants,
  ensureTenantSchema,
  seedFlowJob,
  clearTenantSchema,
} from '../db/test/seed';
import { flowJobs, inboxTasks } from '../db/schema/tenant';

describe('ExecutionOrchestratorService', () => {
  const { db: publicDb, pool } = testDb();
  const tenantDbFactory = testTenantDbFactory();
  const tenantRegistry = new TenantRegistryService(publicDb);
  const jobClaimService = new JobClaimService(tenantDbFactory);
  const workerRunnerService = new WorkerRunnerService();
  const progressPublisherService = new ProgressPublisherService(pool);
  const inboxTaskWriter = new TenantInboxTaskWriter(tenantDbFactory);
  const orchestrator = new ExecutionOrchestratorService(
    tenantRegistry,
    jobClaimService,
    workerRunnerService,
    progressPublisherService,
    inboxTaskWriter,
  );

  const schemaA = 'tenant_test_orch_a';
  const schemaB = 'tenant_test_orch_b';

  beforeAll(async () => {
    await ensureTenantSchema(schemaA);
    await ensureTenantSchema(schemaB);
  });

  afterEach(async () => {
    await clearTenants(publicDb);
    await clearTenantSchema(tenantDbFactory, schemaA);
    await clearTenantSchema(tenantDbFactory, schemaB);
  });

  afterAll(async () => {
    await pool.end();
    await tenantDbFactory.closeAll();
  });

  it('claims a job from the registered tenant, publishes token events, and marks it completed', async () => {
    await seedTenant(publicDb, { slug: 'a', schemaName: schemaA });
    const seeded = await seedFlowJob(tenantDbFactory, schemaA, {
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

    const db = tenantDbFactory.getTenantDb(schemaA);
    const [row] = await db.select().from(flowJobs).where(eq(flowJobs.id, seeded.id));
    expect(row.status).toBe('completed');

    await listener.end();
  }, 15000);

  it('returns false when there is no registered tenant', async () => {
    const ran = await orchestrator.processNext();
    expect(ran).toBe(false);
  });

  it('returns false when a registered tenant has no pending job', async () => {
    await seedTenant(publicDb, { slug: 'a', schemaName: schemaA });
    const ran = await orchestrator.processNext();
    expect(ran).toBe(false);
  });

  it('fails the job exactly once when the worker emits a kind:error message', async () => {
    await seedTenant(publicDb, { slug: 'a', schemaName: schemaA });
    const seeded = await seedFlowJob(tenantDbFactory, schemaA, {
      input: {
        definition: { entryNodeId: 'llm-1', nodes: [], edges: [], stateSchema: { fields: [] } },
        input: { input: 'hi' },
      },
    });

    const ran = await orchestrator.processNext();
    expect(ran).toBe(true);

    const db = tenantDbFactory.getTenantDb(schemaA);
    const [row] = await db.select().from(flowJobs).where(eq(flowJobs.id, seeded.id));
    expect(row.status).toBe('failed');
    expect(row.error).toContain("Unknown entryNodeId 'llm-1'");
  }, 15000);

  it('writes an inbox task and marks the job waiting when a form node interrupts', async () => {
    await seedTenant(publicDb, { slug: 'a', schemaName: schemaA });
    const launcherId = '66666666-6666-6666-6666-666666666666';
    const seeded = await seedFlowJob(tenantDbFactory, schemaA, {
      userId: launcherId,
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

    const db = tenantDbFactory.getTenantDb(schemaA);
    const [task] = await db.select().from(inboxTasks).where(eq(inboxTasks.runId, seeded.id));
    expect(task).toMatchObject({
      nodeId: 'form-1',
      prompt: 'Approve?',
      assigneeUserId: launcherId,
    });

    const [row] = await db.select().from(flowJobs).where(eq(flowJobs.id, seeded.id));
    expect(row.status).toBe('waiting');
    expect(row.runId).toBe(seeded.id);
  }, 15000);

  it('processes a resume job by loading the checkpoint and continuing', async () => {
    await seedTenant(publicDb, { slug: 'a', schemaName: schemaA });
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
            fields: [{ key: 'approved', label: 'Approved?', type: 'boolean', required: true }],
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

    const started = await seedFlowJob(tenantDbFactory, schemaA, {
      input: { definition, input: { input: 'hi' } },
    });
    await orchestrator.processNext();

    const resumed = await seedFlowJob(tenantDbFactory, schemaA, {
      type: 'resume',
      runId: started.id,
      input: { definition, resumeValues: { approved: true } },
    });

    const ran = await orchestrator.processNext();
    expect(ran).toBe(true);

    const db = tenantDbFactory.getTenantDb(schemaA);
    const [row] = await db.select().from(flowJobs).where(eq(flowJobs.id, resumed.id));
    expect(row.status).toBe('completed');
  }, 15000);

  it('round-robins across tenants instead of starving one', async () => {
    await seedTenant(publicDb, { slug: 'a', schemaName: schemaA });
    await seedTenant(publicDb, { slug: 'b', schemaName: schemaB });

    const jobA = await seedFlowJob(tenantDbFactory, schemaA, {
      input: {
        definition: { entryNodeId: 'llm-1', nodes: [], edges: [], stateSchema: { fields: [] } },
        input: { input: 'hi' },
      },
    });
    const jobB = await seedFlowJob(tenantDbFactory, schemaB, {
      input: {
        definition: { entryNodeId: 'llm-1', nodes: [], edges: [], stateSchema: { fields: [] } },
        input: { input: 'hi' },
      },
    });

    await orchestrator.processNext();
    await orchestrator.processNext();

    const dbA = tenantDbFactory.getTenantDb(schemaA);
    const dbB = tenantDbFactory.getTenantDb(schemaB);
    const [rowA] = await dbA.select().from(flowJobs).where(eq(flowJobs.id, jobA.id));
    const [rowB] = await dbB.select().from(flowJobs).where(eq(flowJobs.id, jobB.id));

    expect(rowA.status).toBe('failed');
    expect(rowB.status).toBe('failed');
  }, 15000);
});
