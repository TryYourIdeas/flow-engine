import { Injectable } from '@nestjs/common';
import { Worker } from 'node:worker_threads';
import * as path from 'node:path';
import type { WorkerData, WorkerMessage } from './worker-messages.types';

@Injectable()
export class WorkerRunnerService {
  async *run(data: WorkerData): AsyncGenerator<WorkerMessage> {
    const isTs = __filename.endsWith('.ts');
    const workerPath = path.join(
      __dirname,
      isTs ? 'graph-execution.worker.ts' : 'graph-execution.worker.js',
    );

    const worker = new Worker(workerPath, {
      workerData: data,
      execArgv: isTs ? ['-r', 'ts-node/register'] : [],
    });

    const messages: WorkerMessage[] = [];
    let resolveNext: (() => void) | null = null;
    let finished = false;

    worker.on('message', (message: WorkerMessage) => {
      messages.push(message);
      if (message.kind === 'done' || message.kind === 'error') {
        finished = true;
      }
      resolveNext?.();
    });

    worker.on('error', (err: Error) => {
      messages.push({ kind: 'error', message: err.message });
      finished = true;
      resolveNext?.();
    });

    try {
      while (true) {
        while (messages.length > 0) {
          const message = messages.shift()!;
          yield message;
          if (message.kind === 'done' || message.kind === 'error') {
            return;
          }
        }
        if (finished) return;
        await new Promise<void>((resolve) => {
          resolveNext = resolve;
        });
      }
    } finally {
      await worker.terminate();
    }
  }
}
