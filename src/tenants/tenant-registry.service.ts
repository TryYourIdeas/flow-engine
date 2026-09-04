import { Injectable } from '@nestjs/common';
import { asc } from 'drizzle-orm';
import type { createDb } from '../db/client';
import { tenants } from '../db/schema/public';

@Injectable()
export class TenantRegistryService {
  constructor(private readonly db: ReturnType<typeof createDb>['db']) {}

  async listTenantSchemas(): Promise<string[]> {
    const rows = await this.db
      .select({ schemaName: tenants.schemaName })
      .from(tenants)
      .orderBy(asc(tenants.schemaName));
    return rows.map((r) => r.schemaName);
  }
}
