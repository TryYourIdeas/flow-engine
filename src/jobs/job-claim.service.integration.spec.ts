import { eq } from 'drizzle-orm';
import { JobClaimService } from './job-claim.service';
import {
  testTenantDbFactory,
  ensureTenantSchema,
  seedFlowJob,
  clearTenantSchema,
} from '../db/test/seed';
import { flowJobs } from '../db/schema/tenant';

describe('JobClaimService', () => {
  const tenantDbFactory = testTenantDbFactory();
  const service = new JobClaimService(tenantDbFactory);
  const schemaName = 'tenant_test_job_claim';

  beforeAll(async () => {
    await ensureTenantSchema(schemaName);
  });

  afterEach(async () => {
    await clearTenantSchema(tenantDbFactory, schemaName);
  });

  afterAll(async () => {
    await tenantDbFactory.closeAll();
  });

  it('claims a pending job in the given tenant schema and marks it running', async () => {
    const seeded = await seedFlowJob(tenantDbFactory, schemaName);

    const claimed = await service.claimNext(schemaName);

    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(seeded.id);
    expect(claimed!.schemaName).toBe(schemaName);
    expect(claimed!.graphId).toBe(seeded.graphId);
  });

  it('returns null when there is no pending job in that schema', async () => {
    const claimed = await service.claimNext(schemaName);
    expect(claimed).toBeNull();
  });

  it('never lets two concurrent claims in the same schema return the same job', async () => {
    await seedFlowJob(tenantDbFactory, schemaName);
    await seedFlowJob(tenantDbFactory, schemaName);

    const [first, second] = await Promise.all([
      service.claimNext(schemaName),
      service.claimNext(schemaName),
    ]);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.id).not.toBe(second!.id);
  });

  it('marks a running job waiting and records its runId', async () => {
    const seeded = await seedFlowJob(tenantDbFactory, schemaName);
    await service.claimNext(schemaName);

    const runId = '33333333-3333-3333-3333-333333333333';
    await service.markWaiting(schemaName, seeded.id, runId);

    const db = tenantDbFactory.getTenantDb(schemaName);
    const [row] = await db.select().from(flowJobs).where(eq(flowJobs.id, seeded.id));
    expect(row.status).toBe('waiting');
    expect(row.runId).toBe(runId);
  });
});
