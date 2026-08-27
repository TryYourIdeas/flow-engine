import { createDb } from '../client';
import { jobs } from '../schema/public';

export function testDb() {
  const connectionString =
    process.env.DATABASE_URL ??
    'postgres://flow_engine:flow_engine@localhost:5433/flow_engine';
  return createDb(connectionString);
}

export async function seedJob(
  db: ReturnType<typeof createDb>['db'],
  overrides: Partial<typeof jobs.$inferInsert> = {},
) {
  const [row] = await db
    .insert(jobs)
    .values({
      type: 'run',
      tenantId: 'tenant-1',
      userId: 'user-1',
      graphId: 'graph-1',
      status: 'pending',
      ...overrides,
    })
    .returning();
  return row;
}

export async function clearJobs(db: ReturnType<typeof createDb>['db']) {
  await db.delete(jobs);
}
