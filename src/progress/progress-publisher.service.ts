import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { WorkerMessage } from '../worker/worker-messages.types';

@Injectable()
export class ProgressPublisherService {
  constructor(private readonly pool: Pool) {}

  async publish(runId: string, message: WorkerMessage): Promise<void> {
    const channel = `run:${runId}`;
    const payload = JSON.stringify(message);
    await this.pool.query('SELECT pg_notify($1, $2)', [channel, payload]);
  }
}
