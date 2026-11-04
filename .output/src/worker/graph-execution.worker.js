"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_worker_threads_1 = require("node:worker_threads");
const langgraph_checkpoint_postgres_1 = require("@langchain/langgraph-checkpoint-postgres");
const graph_interpreter_1 = require("../graph/graph-interpreter");
const fake_llm_provider_1 = require("../graph/fake-llm-provider");
function post(message) {
    node_worker_threads_1.parentPort.postMessage(message);
}
async function main() {
    const data = node_worker_threads_1.workerData;
    const connectionString = process.env.DATABASE_URL ??
        'postgres://flow_engine:flow_engine@localhost:5433/flow_engine';
    const checkpointer = langgraph_checkpoint_postgres_1.PostgresSaver.fromConnString(connectionString, {
        schema: data.schemaName,
    });
    await checkpointer.setup();
    const interpreter = new graph_interpreter_1.GraphInterpreter(new fake_llm_provider_1.FakeLlmProvider(), checkpointer);
    try {
        let waiting = null;
        const input = data.kind === 'start'
            ? { kind: 'start', input: data.input.input }
            : { kind: 'resume', resumeValues: data.resumeValues };
        for await (const event of interpreter.run(data.definition, data.runId, input)) {
            if (event.kind === 'token') {
                post({ kind: 'token', nodeId: event.nodeId, token: event.token });
            }
            else {
                waiting = {
                    kind: 'waiting_for_input',
                    nodeId: event.nodeId,
                    prompt: event.prompt,
                    fields: event.fields,
                    assigneeMode: event.assigneeMode,
                    assigneeUserId: event.assigneeUserId,
                };
            }
        }
        post(waiting ?? { kind: 'done' });
    }
    catch (err) {
        post({
            kind: 'error',
            message: err instanceof Error ? err.message : String(err),
        });
    }
}
void main();
//# sourceMappingURL=graph-execution.worker.js.map