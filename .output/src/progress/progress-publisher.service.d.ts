import type { Pool } from 'pg';
import type { WorkerMessage } from '../worker/worker-messages.types';
export declare class ProgressPublisherService {
    private readonly pool;
    constructor(pool: Pool);
    publish(runId: string, message: WorkerMessage): Promise<void>;
}
