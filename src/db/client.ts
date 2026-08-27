import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Logger } from '@nestjs/common';
import * as publicSchema from './schema/public';

const logger = new Logger('DbPool');

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  // node-postgres emits 'error' on the Pool (not a query rejection) when an
  // idle pooled client loses its connection (server restart, network blip,
  // admin-initiated termination, etc). Without a listener, this is an
  // unhandled EventEmitter error and crashes the process. Log and continue
  // instead — the pool recovers by opening a new connection on next use.
  pool.on('error', (err) => {
    logger.error(
      `unexpected error on idle Postgres client: ${err.message}`,
      err.stack,
    );
  });
  const db = drizzle(pool, { schema: publicSchema });
  return { db, pool };
}
