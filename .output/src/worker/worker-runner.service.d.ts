import type { WorkerData, WorkerMessage } from './worker-messages.types';
export declare class WorkerRunnerService {
    run(data: WorkerData): AsyncGenerator<WorkerMessage>;
}
