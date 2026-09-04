import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { createDb } from '../db/client';
import type { ClaimedJob } from './job.types';

@Injectable()
export class JobClaimService {
  constructor(private readonly db: ReturnType<typeof createDb>['db']) {}

  async claimNext(): Promise<ClaimedJob | null> {
    const result = await this.db.execute<{
      id: string;
      type: 'run' | 'resume';
      tenant_id: string;
      user_id: string;
      graph_id: string;
      run_id: string | null;
      input: unknown;
    }>(sql`
      UPDATE jobs
      SET status = 'running', updated_at = now()
      WHERE id = (
        SELECT id FROM jobs
        WHERE status = 'pending'
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, type, tenant_id, user_id, graph_id, run_id, input
    `);

    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      type: row.type,
      tenantId: row.tenant_id,
      userId: row.user_id,
      graphId: row.graph_id,
      runId: row.run_id,
      input: row.input,
    };
  }

  async complete(jobId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE jobs SET status = 'completed', updated_at = now() WHERE id = ${jobId}
    `);
  }

  async fail(jobId: string, error: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE jobs SET status = 'failed', error = ${error}, updated_at = now() WHERE id = ${jobId}
    `);
  }

  async markWaiting(jobId: string, runId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE jobs SET status = 'waiting', run_id = ${runId}, updated_at = now() WHERE id = ${jobId}
    `);
  }
}
