import {
  StateGraph,
  Annotation,
  START,
  END,
  interrupt,
  Command,
  isInterrupted,
  INTERRUPT,
  type BaseCheckpointSaver,
} from '@langchain/langgraph';
import type {
  GraphDefinition,
  GraphNode,
  StateField,
  FormField,
} from './graph-definition.types';
import type { LlmProviderPort } from './llm-provider.port';

export interface FormInterruptPayload {
  nodeId: string;
  prompt: string;
  fields: FormField[];
  assigneeMode: 'launcher' | 'specific_user';
  assigneeUserId?: string;
}

export type InterpreterEvent =
  | { kind: 'token'; nodeId: string; token: string }
  | ({ kind: 'interrupted' } & FormInterruptPayload);

export interface InterpreterStartInput {
  kind: 'start';
  input: string;
}

export interface InterpreterResumeInput {
  kind: 'resume';
  resumeValues: Record<string, unknown>;
}

export type InterpreterInput = InterpreterStartInput | InterpreterResumeInput;

// The graph's shape (which nodes/channels exist) is determined entirely by
// runtime JSON (GraphDefinition), not known at compile time, so the
// StateGraph builder chain below is intentionally untyped (`any`) rather
// than fought into LangGraph JS's generic fluent-builder types.
function buildStateAnnotation(fields: StateField[]) {
  const spec: Record<string, unknown> = {
    input: Annotation<string>(),
    output: Annotation<string>({
      reducer: (existing: string, update: string) => existing + update,
      default: () => '',
    }),
  };
  for (const field of fields) {
    spec[field.key] = Annotation<unknown>();
  }
  return Annotation.Root(spec as never);
}

function buildNodeHandler(
  node: GraphNode,
  llmProvider: LlmProviderPort,
  events: InterpreterEvent[],
) {
  if (node.type === 'llm') {
    return async (state: Record<string, unknown>) => {
      let output = '';
      for await (const { token } of llmProvider.streamCompletion({
        systemPrompt: node.data.systemPrompt,
        model: node.data.model,
        temperature: node.data.temperature,
        input: state.input as string,
      })) {
        events.push({ kind: 'token', nodeId: node.id, token });
        output += token;
      }
      return { output };
    };
  }

  if (node.type === 'form') {
    return async () => {
      const resumeValues = interrupt<
        FormInterruptPayload,
        Record<string, unknown>
      >({
        nodeId: node.id,
        prompt: node.data.prompt,
        fields: node.data.fields,
        assigneeMode: node.data.assigneeMode,
        assigneeUserId: node.data.assigneeUserId,
      });
      return resumeValues;
    };
  }

  throw new Error(`Unsupported node type '${(node as GraphNode).type}'`);
}

export class GraphInterpreter {
  constructor(
    private readonly llmProvider: LlmProviderPort,
    private readonly checkpointer: BaseCheckpointSaver,
  ) {}

  async *run(
    definition: GraphDefinition,
    runId: string,
    input: InterpreterInput,
  ): AsyncGenerator<InterpreterEvent> {
    if (!definition.nodes.some((n) => n.id === definition.entryNodeId)) {
      throw new Error(`Unknown entryNodeId '${definition.entryNodeId}'`);
    }

    const events: InterpreterEvent[] = [];
    const stateAnnotation = buildStateAnnotation(definition.stateSchema.fields);
    let graph: any = new StateGraph(stateAnnotation);

    for (const node of definition.nodes) {
      graph = graph.addNode(
        node.id,
        buildNodeHandler(node, this.llmProvider, events),
      );
    }

    graph = graph.addEdge(START, definition.entryNodeId);
    const hasOutgoing = new Set(definition.edges.map((e) => e.source));
    for (const edge of definition.edges) {
      graph = graph.addEdge(edge.source, edge.target);
    }
    for (const node of definition.nodes) {
      if (!hasOutgoing.has(node.id)) {
        graph = graph.addEdge(node.id, END);
      }
    }

    const compiled = graph.compile({ checkpointer: this.checkpointer });
    const config = { configurable: { thread_id: runId } };
    const invokeInput =
      input.kind === 'start'
        ? { input: input.input }
        : new Command({ resume: input.resumeValues });

    const result = await compiled.invoke(invokeInput, config);

    for (const event of events) {
      yield event;
    }

    if (isInterrupted<FormInterruptPayload>(result)) {
      const payload = result[INTERRUPT][0]?.value;
      if (!payload) {
        throw new Error('graph interrupted with no payload');
      }
      yield { kind: 'interrupted', ...payload };
    }
  }
}
