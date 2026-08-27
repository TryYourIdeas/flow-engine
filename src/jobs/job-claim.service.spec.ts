import { JobClaimService } from './job-claim.service';
import { testDb, seedJob, clearJobs } from '../db/test/seed';

describe('JobClaimService', () => {
  const { db, pool } = testDb();
  const service = new JobClaimService(db);

  afterEach(async () => {
    await clearJobs(db);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('claims a pending job and marks it running', async () => {
    const seeded = await seedJob(db);

    const claimed = await service.claimNext();

    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(seeded.id);
    expect(claimed!.tenantId).toBe('tenant-1');
    expect(claimed!.graphId).toBe('graph-1');
  });

  it('returns null when there is no pending job', async () => {
    const claimed = await service.claimNext();
    expect(claimed).toBeNull();
  });

  it('never lets two concurrent claims return the same job', async () => {
    await seedJob(db);
    await seedJob(db);

    const [first, second] = await Promise.all([
      service.claimNext(),
      service.claimNext(),
    ]);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.id).not.toBe(second!.id);
  });
});
