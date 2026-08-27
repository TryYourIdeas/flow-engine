import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import type { GraphDefinition } from './graph-definition.types';
import type { LlmProviderPort } from './llm-provider.port';

const ExecutionState = Annotation.Root({
  input: Annotation<string>,
  output: Annotation<string>({
    reducer: (existing, update) => existing + update,
    default: () => '',
  }),
});

export interface InterpreterInput {
  input: string;
}

export interface InterpreterEvent {
  nodeId: string;
  token: string;
}

export class GraphInterpreter {
  constructor(private readonly llmProvider: LlmProviderPort) {}

  async *run(
    definition: GraphDefinition,
    input: InterpreterInput,
  ): AsyncGenerator<InterpreterEvent> {
    if (definition.nodes.length !== 1 || definition.nodes[0].type !== 'llm') {
      throw new Error(
        'GraphInterpreter currently supports exactly one llm node',
      );
    }

    const node = definition.nodes[0];
    const events: InterpreterEvent[] = [];

    const graph = new StateGraph(ExecutionState)
      .addNode(node.id, async (state) => {
        let output = '';
        for await (const { token } of this.llmProvider.streamCompletion({
          systemPrompt: node.data.systemPrompt,
          model: node.data.model,
          temperature: node.data.temperature,
          input: state.input,
        })) {
          events.push({ nodeId: node.id, token });
          output += token;
        }
        return { output };
      })
      .addEdge(START, node.id)
      .addEdge(node.id, END)
      .compile();

    await graph.invoke({ input: input.input, output: '' });

    for (const event of events) {
      yield event;
    }
  }
}
