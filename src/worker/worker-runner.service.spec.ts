import { WorkerRunnerService } from './worker-runner.service';
import type { GraphDefinition } from '../graph/graph-definition.types';

describe('WorkerRunnerService', () => {
  const definition: GraphDefinition = {
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
  };

  it('streams token messages then a done message', async () => {
    const service = new WorkerRunnerService();
    const messages: string[] = [];

    for await (const message of service.run({
      definition,
      input: { input: 'hi' },
    })) {
      messages.push(message.kind);
    }

    expect(messages[messages.length - 1]).toBe('done');
    expect(messages.filter((k) => k === 'token').length).toBeGreaterThan(0);
  }, 15000);
});
