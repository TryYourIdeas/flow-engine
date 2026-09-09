"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GraphInterpreter = void 0;
const langgraph_1 = require("@langchain/langgraph");
function buildStateAnnotation(fields) {
    const spec = {
        input: (0, langgraph_1.Annotation)(),
        output: (0, langgraph_1.Annotation)({
            reducer: (existing, update) => existing + update,
            default: () => '',
        }),
    };
    for (const field of fields) {
        spec[field.key] = (0, langgraph_1.Annotation)();
    }
    return langgraph_1.Annotation.Root(spec);
}
function buildNodeHandler(node, llmProvider, events) {
    if (node.type === 'llm') {
        return async (state) => {
            let output = '';
            for await (const { token } of llmProvider.streamCompletion({
                systemPrompt: node.data.systemPrompt,
                model: node.data.model,
                temperature: node.data.temperature,
                input: state.input,
            })) {
                events.push({ kind: 'token', nodeId: node.id, token });
                output += token;
            }
            return { output };
        };
    }
    if (node.type === 'form') {
        return async () => {
            const resumeValues = (0, langgraph_1.interrupt)({
                nodeId: node.id,
                prompt: node.data.prompt,
                fields: node.data.fields,
                assigneeMode: node.data.assigneeMode,
                assigneeUserId: node.data.assigneeUserId,
            });
            return resumeValues;
        };
    }
    throw new Error(`Unsupported node type '${node.type}'`);
}
class GraphInterpreter {
    llmProvider;
    checkpointer;
    constructor(llmProvider, checkpointer) {
        this.llmProvider = llmProvider;
        this.checkpointer = checkpointer;
    }
    async *run(definition, runId, input) {
        if (!definition.nodes.some((n) => n.id === definition.entryNodeId)) {
            throw new Error(`Unknown entryNodeId '${definition.entryNodeId}'`);
        }
        const events = [];
        const stateAnnotation = buildStateAnnotation(definition.stateSchema.fields);
        let graph = new langgraph_1.StateGraph(stateAnnotation);
        for (const node of definition.nodes) {
            graph = graph.addNode(node.id, buildNodeHandler(node, this.llmProvider, events));
        }
        graph = graph.addEdge(langgraph_1.START, definition.entryNodeId);
        const hasOutgoing = new Set(definition.edges.map((e) => e.source));
        for (const edge of definition.edges) {
            graph = graph.addEdge(edge.source, edge.target);
        }
        for (const node of definition.nodes) {
            if (!hasOutgoing.has(node.id)) {
                graph = graph.addEdge(node.id, langgraph_1.END);
            }
        }
        const compiled = graph.compile({ checkpointer: this.checkpointer });
        const config = { configurable: { thread_id: runId } };
        const invokeInput = input.kind === 'start'
            ? { input: input.input }
            : new langgraph_1.Command({ resume: input.resumeValues });
        const result = await compiled.invoke(invokeInput, config);
        for (const event of events) {
            yield event;
        }
        if ((0, langgraph_1.isInterrupted)(result)) {
            const payload = result[langgraph_1.INTERRUPT][0]?.value;
            if (!payload) {
                throw new Error('graph interrupted with no payload');
            }
            yield { kind: 'interrupted', ...payload };
        }
    }
}
exports.GraphInterpreter = GraphInterpreter;
//# sourceMappingURL=graph-interpreter.js.map