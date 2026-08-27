import { parentPort, workerData } from 'node:worker_threads';
import { GraphInterpreter } from '../graph/graph-interpreter';
import { FakeLlmProvider } from '../graph/fake-llm-provider';
import type { WorkerData, WorkerMessage } from './worker-messages.types';

function post(message: WorkerMessage) {
  parentPort!.postMessage(message);
}

async function main() {
  const data = workerData as WorkerData;
  // NOTE: FakeLlmProvider is a placeholder wired here so this task is
  // end-to-end testable without a real provider dependency. Swapping in a
  // real LlmProviderPort implementation (keyed by node.data.provider) is a
  // follow-up task, not part of this plan.
  const interpreter = new GraphInterpreter(new FakeLlmProvider());

  try {
    for await (const event of interpreter.run(data.definition, data.input)) {
      post({ kind: 'token', nodeId: event.nodeId, token: event.token });
    }
    post({ kind: 'done' });
  } catch (err) {
    post({ kind: 'error', message: (err as Error).message });
  }
}

void main();
