import { MemorySaver } from '@langchain/langgraph';
import { GraphInterpreter } from './graph-interpreter';
import { FakeLlmProvider } from './fake-llm-provider';
import type { GraphDefinition } from './graph-definition.types';
import type {
  LlmProviderPort,
  LlmCompletionParams,
} from './llm-provider.port';

class ThrowingLlmProvider implements LlmProviderPort {
  async *streamCompletion(
    _params: LlmCompletionParams,
  ): AsyncIterable<{ token: string }> {
    yield { token: 'partial' };
    throw new Error('provider failed');
  }
}

describe('GraphInterpreter', () => {
  const singleLlmDefinition: GraphDefinition = {
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
    stateSchema: { fields: [] },
  };

  it('streams tokens from a single LLM node in order', async () => {
    const provider = new FakeLlmProvider(['Hi', ' there']);
    const interpreter = new GraphInterpreter(provider, new MemorySaver());

    const events: unknown[] = [];
    for await (const event of interpreter.run(singleLlmDefinition, 'run-1', {
      kind: 'start',
      input: 'Hello',
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { kind: 'token', nodeId: 'llm-1', token: 'Hi' },
      { kind: 'token', nodeId: 'llm-1', token: ' there' },
    ]);
  });

  it('walks two chained LLM nodes in edge order', async () => {
    const provider = new FakeLlmProvider(['step']);
    const interpreter = new GraphInterpreter(provider, new MemorySaver());
    const definition: GraphDefinition = {
      entryNodeId: 'llm-1',
      nodes: [
        {
          id: 'llm-1',
          type: 'llm',
          data: {
            systemPrompt: 'first',
            provider: 'anthropic',
            model: 'claude-test',
            temperature: 0.5,
          },
        },
        {
          id: 'llm-2',
          type: 'llm',
          data: {
            systemPrompt: 'second',
            provider: 'anthropic',
            model: 'claude-test',
            temperature: 0.5,
          },
        },
      ],
      edges: [{ source: 'llm-1', target: 'llm-2' }],
      stateSchema: { fields: [] },
    };

    const events: unknown[] = [];
    for await (const event of interpreter.run(definition, 'run-2', {
      kind: 'start',
      input: 'Hello',
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { kind: 'token', nodeId: 'llm-1', token: 'step' },
      { kind: 'token', nodeId: 'llm-2', token: 'step' },
    ]);
  });

  it('propagates an error thrown mid-stream by the LLM provider', async () => {
    const provider = new ThrowingLlmProvider();
    const interpreter = new GraphInterpreter(provider, new MemorySaver());

    const collect = async () => {
      const events: unknown[] = [];
      for await (const event of interpreter.run(singleLlmDefinition, 'run-3', {
        kind: 'start',
        input: 'Hello',
      })) {
        events.push(event);
      }
      return events;
    };

    await expect(collect()).rejects.toThrow('provider failed');
  });

  it('rejects a definition whose entryNodeId is not a real node', async () => {
    const provider = new FakeLlmProvider();
    const interpreter = new GraphInterpreter(provider, new MemorySaver());
    const definition: GraphDefinition = {
      entryNodeId: 'missing',
      nodes: [],
      edges: [],
      stateSchema: { fields: [] },
    };

    const collect = async () => {
      const events: unknown[] = [];
      for await (const event of interpreter.run(definition, 'run-4', {
        kind: 'start',
        input: 'hi',
      })) {
        events.push(event);
      }
      return events;
    };

    await expect(collect()).rejects.toThrow("Unknown entryNodeId 'missing'");
  });
});
