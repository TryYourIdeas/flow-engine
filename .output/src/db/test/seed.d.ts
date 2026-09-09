import { createDb } from '../client';
import { tenants } from '../schema/public';
import { flowJobs } from '../schema/tenant';
import { TenantDbFactory } from '../tenantDb';
export declare function testDb(): {
    db: import("drizzle-orm/node-postgres").NodePgDatabase<typeof import("../schema/public")> & {
        $client: import("pg").Pool;
    };
    pool: import("pg").Pool;
};
export declare function testTenantDbFactory(): TenantDbFactory;
export declare function seedTenant(db: ReturnType<typeof createDb>['db'], overrides?: Partial<typeof tenants.$inferInsert>): Promise<{
    id: string;
    slug: string;
    schemaName: string;
}>;
export declare function clearTenants(db: ReturnType<typeof createDb>['db']): Promise<void>;
export declare function ensureTenantSchema(schemaName: string): Promise<void>;
export declare function seedFlowJob(tenantDbFactory: TenantDbFactory, schemaName: string, overrides?: Partial<typeof flowJobs.$inferInsert>): Promise<{
    id: string;
    error: string | null;
    type: "run" | "resume";
    graphId: string;
    userId: string;
    runId: string | null;
    input: unknown;
    status: "pending" | "running" | "waiting" | "completed" | "failed";
    createdAt: Date;
    updatedAt: Date;
}>;
export declare function clearTenantSchema(tenantDbFactory: TenantDbFactory, schemaName: string): Promise<void>;
