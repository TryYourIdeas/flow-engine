import type { createDb } from '../db/client';
export declare class TenantRegistryService {
    private readonly db;
    constructor(db: ReturnType<typeof createDb>['db']);
    listTenantSchemas(): Promise<string[]>;
}
