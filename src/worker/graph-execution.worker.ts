import { parentPort, workerData } from 'node:worker_threads';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { GraphInterpreter } from '../graph/graph-interpreter';
import { FakeLlmProvider } from '../graph/fake-llm-provider';
import type { WorkerData, WorkerMessage } from './worker-messages.types';

function post(message: WorkerMessage) {
  parentPort!.postMessage(message);
}

async function main() {
  const data = workerData as WorkerData;
  const connectionString =
    process.env.DATABASE_URL ??
    'postgres://flow_engine:flow_engine@localhost:5433/flow_engine';
  const checkpointer = PostgresSaver.fromConnString(connectionString);
  await checkpointer.setup();

  // NOTE: FakeLlmProvider is a placeholder wired here so this task is
  // end-to-end testable without a real provider dependency. Swapping in a
  // real LlmProviderPort implementation (keyed by node.data.provider) is a
  // follow-up task, not part of this plan.
  const interpreter = new GraphInterpreter(new FakeLlmProvider(), checkpointer);

  try {
    let waiting: Extract<WorkerMessage, { kind: 'waiting_for_input' }> | null =
      null;

    const input =
      data.kind === 'start'
        ? ({ kind: 'start', input: data.input.input } as const)
        : ({ kind: 'resume', resumeValues: data.resumeValues } as const);

    for await (const event of interpreter.run(data.definition, data.runId, input)) {
      if (event.kind === 'token') {
        post({ kind: 'token', nodeId: event.nodeId, token: event.token });
      } else {
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
  } catch (err) {
    post({
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

void main();
