import { GraphInterpreter } from './graph-interpreter';
import { FakeLlmProvider } from './fake-llm-provider';
import type { GraphDefinition } from './graph-definition.types';

describe('GraphInterpreter', () => {
  const definition: GraphDefinition = {
    entryNodeId: 'llm-1',
    nodes: [
      {
        id: 'llm-1',
        type: 'llm',
        data: {
          systemPrompt: 'You are a helpful assistant.',
          provider: 'anthropic',
          model: 'claude-test',
          temperature: 0.7,
        },
      },
    ],
    edges: [],
  };

  it('streams tokens from the single LLM node in order', async () => {
    const provider = new FakeLlmProvider(['Hi', ' there']);
    const interpreter = new GraphInterpreter(provider);

    const events: { nodeId: string; token: string }[] = [];
    for await (const event of interpreter.run(definition, {
      input: 'Hello',
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { nodeId: 'llm-1', token: 'Hi' },
      { nodeId: 'llm-1', token: ' there' },
    ]);
  });
});
