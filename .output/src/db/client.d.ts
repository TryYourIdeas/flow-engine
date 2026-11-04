import { Pool } from 'pg';
import * as publicSchema from './schema/public';
export declare function createDb(connectionString: string): {
    db: import("drizzle-orm/node-postgres").NodePgDatabase<typeof publicSchema> & {
        $client: Pool;
    };
    pool: Pool;
};
