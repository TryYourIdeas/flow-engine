import { FakeInboxTaskWriter } from './fake-inbox-task-writer';

describe('FakeInboxTaskWriter', () => {
  it('records created tasks in memory', async () => {
    const writer = new FakeInboxTaskWriter();

    await writer.createTask({
      schemaName: 'tenant_test',
      runId: 'run-1',
      nodeId: 'form-1',
      prompt: 'Approve?',
      fields: [{ key: 'approved', label: 'Approved?', type: 'boolean', required: true }],
      assigneeUserId: 'user-1',
    });

    expect(writer.tasks).toEqual([
      {
        schemaName: 'tenant_test',
        runId: 'run-1',
        nodeId: 'form-1',
        prompt: 'Approve?',
        fields: [{ key: 'approved', label: 'Approved?', type: 'boolean', required: true }],
        assigneeUserId: 'user-1',
      },
    ]);
  });
});
