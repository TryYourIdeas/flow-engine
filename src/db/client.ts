import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as publicSchema from './schema/public';

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema: publicSchema });
  return { db, pool };
}
