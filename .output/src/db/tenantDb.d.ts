import { Pool } from 'pg';
import * as tenantSchema from './schema/tenant';
export declare class TenantDbFactory {
    private readonly connectionString;
    private readonly pools;
    private readonly clients;
    constructor(connectionString: string);
    private touch;
    private evictOldestIfNeeded;
    getTenantDb(schemaName: string): (import("drizzle-orm/node-postgres").NodePgDatabase<Record<string, unknown>> & {
        $client: Pool;
    }) | (import("drizzle-orm/node-postgres").NodePgDatabase<typeof tenantSchema> & {
        $client: Pool;
    });
    closeAll(): Promise<void>;
}
