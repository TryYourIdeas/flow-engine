import { eq } from 'drizzle-orm';
import { TenantInboxTaskWriter } from './tenant-inbox-task-writer';
import {
  testTenantDbFactory,
  ensureTenantSchema,
  clearTenantSchema,
} from '../db/test/seed';
import { inboxTasks } from '../db/schema/tenant';

describe('TenantInboxTaskWriter', () => {
  const tenantDbFactory = testTenantDbFactory();
  const writer = new TenantInboxTaskWriter(tenantDbFactory);
  const schemaName = 'tenant_test_inbox_writer';

  beforeAll(async () => {
    await ensureTenantSchema(schemaName);
  });

  afterEach(async () => {
    await clearTenantSchema(tenantDbFactory, schemaName);
  });

  afterAll(async () => {
    await tenantDbFactory.closeAll();
  });

  it('writes a real inbox_tasks row into the given tenant schema', async () => {
    await writer.createTask({
      schemaName,
      runId: '44444444-4444-4444-4444-444444444444',
      nodeId: 'form-1',
      prompt: 'Approve?',
      fields: [{ key: 'approved', label: 'Approved?', type: 'boolean', required: true }],
      assigneeUserId: '55555555-5555-5555-5555-555555555555',
    });

    const db = tenantDbFactory.getTenantDb(schemaName);
    const [row] = await db
      .select()
      .from(inboxTasks)
      .where(eq(inboxTasks.runId, '44444444-4444-4444-4444-444444444444'));

    expect(row.nodeId).toBe('form-1');
    expect(row.prompt).toBe('Approve?');
    expect(row.assigneeUserId).toBe('55555555-5555-5555-5555-555555555555');
    expect(row.status).toBe('pending');
    expect(row.fields).toEqual([
      { key: 'approved', label: 'Approved?', type: 'boolean', required: true },
    ]);
  });
});
