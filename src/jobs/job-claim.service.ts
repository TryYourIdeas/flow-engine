import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { TenantDbFactory } from '../db/tenantDb';
import type { ClaimedJob } from './job.types';

@Injectable()
export class JobClaimService {
  constructor(private readonly tenantDbFactory: TenantDbFactory) {}

  async claimNext(schemaName: string): Promise<ClaimedJob | null> {
    const db = this.tenantDbFactory.getTenantDb(schemaName);
    const result = await db.execute<{
      id: string;
      type: 'run' | 'resume';
      graph_id: string;
      user_id: string;
      run_id: string | null;
      input: unknown;
    }>(sql`
      UPDATE flow_jobs
      SET status = 'running', updated_at = now()
      WHERE id = (
        SELECT id FROM flow_jobs
        WHERE status = 'pending'
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, type, graph_id, user_id, run_id, input
    `);

    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      type: row.type,
      schemaName,
      graphId: row.graph_id,
      userId: row.user_id,
      runId: row.run_id,
      input: row.input,
    };
  }

  async complete(schemaName: string, jobId: string): Promise<void> {
    const db = this.tenantDbFactory.getTenantDb(schemaName);
    await db.execute(sql`
      UPDATE flow_jobs SET status = 'completed', updated_at = now() WHERE id = ${jobId}
    `);
  }

  async fail(schemaName: string, jobId: string, error: string): Promise<void> {
    const db = this.tenantDbFactory.getTenantDb(schemaName);
    await db.execute(sql`
      UPDATE flow_jobs SET status = 'failed', error = ${error}, updated_at = now() WHERE id = ${jobId}
    `);
  }

  async markWaiting(
    schemaName: string,
    jobId: string,
    runId: string,
  ): Promise<void> {
    const db = this.tenantDbFactory.getTenantDb(schemaName);
    await db.execute(sql`
      UPDATE flow_jobs SET status = 'waiting', run_id = ${runId}, updated_at = now() WHERE id = ${jobId}
    `);
  }
}
