import { WorkerRunnerService } from './worker-runner.service';
import type { GraphDefinition } from '../graph/graph-definition.types';

describe('WorkerRunnerService', () => {
  const llmOnlyDefinition: GraphDefinition = {
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
  };

  it('streams token messages then a done message', async () => {
    const service = new WorkerRunnerService();
    const messages: string[] = [];

    for await (const message of service.run({
      kind: 'start',
      runId: 'wr-run-1',
      definition: llmOnlyDefinition,
      input: { input: 'hi' },
    })) {
      messages.push(message.kind);
    }

    expect(messages[messages.length - 1]).toBe('done');
    expect(messages.filter((k) => k === 'token').length).toBeGreaterThan(0);
  }, 15000);

  it('surfaces an error message when the definition is unsupported', async () => {
    const invalidDefinition: GraphDefinition = {
      entryNodeId: 'missing',
      nodes: [],
      edges: [],
      stateSchema: { fields: [] },
    };

    const service = new WorkerRunnerService();
    const messages: Array<{ kind: string; message?: string }> = [];

    for await (const message of service.run({
      kind: 'start',
      runId: 'wr-run-2',
      definition: invalidDefinition,
      input: { input: 'hi' },
    })) {
      messages.push(message);
    }

    const lastMessage = messages[messages.length - 1];
    expect(lastMessage.kind).toBe('error');
    expect(lastMessage.message).toContain("Unknown entryNodeId 'missing'");
    expect(messages.some((m) => m.kind === 'done')).toBe(false);
  }, 15000);

  it('posts waiting_for_input and stops when the graph hits a form node', async () => {
    const definition: GraphDefinition = {
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
      ],
      edges: [],
      stateSchema: { fields: [{ key: 'approved', type: 'boolean' }] },
    };

    const service = new WorkerRunnerService();
    const messages: Array<{ kind: string }> = [];

    for await (const message of service.run({
      kind: 'start',
      runId: `wr-run-3-${Date.now()}`,
      definition,
      input: { input: 'hi' },
    })) {
      messages.push(message);
    }

    expect(messages[messages.length - 1].kind).toBe('waiting_for_input');
    expect(messages.some((m) => m.kind === 'done')).toBe(false);
  }, 15000);
});
