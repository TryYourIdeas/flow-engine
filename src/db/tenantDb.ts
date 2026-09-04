import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as tenantSchema from './schema/tenant';

const TENANT_POOL_CACHE_SIZE = 20;
const TENANT_POOL_MAX_CONNECTIONS = 3;

/**
 * Caches a small, dedicated connection pool per tenant schema (search_path
 * fixed at the Postgres startup-parameter level, same technique as home's
 * own getTenantDb() in server/db/client.ts) so flow-engine can claim and
 * run jobs for many tenants against the one shared Postgres instance
 * without per-query search_path juggling. LRU-evicted at
 * TENANT_POOL_CACHE_SIZE cached pools so a long-running process touching
 * many tenants over its lifetime can't accumulate unbounded connections.
 */
export class TenantDbFactory {
  private readonly pools = new Map<string, Pool>();
  private readonly clients = new Map<string, ReturnType<typeof drizzle>>();

  constructor(private readonly connectionString: string) {}

  private touch(schemaName: string) {
    const db = this.clients.get(schemaName)!;
    const pool = this.pools.get(schemaName)!;
    this.clients.delete(schemaName);
    this.pools.delete(schemaName);
    this.clients.set(schemaName, db);
    this.pools.set(schemaName, pool);
  }

  private evictOldestIfNeeded() {
    if (this.clients.size < TENANT_POOL_CACHE_SIZE) return;
    const oldest = this.clients.keys().next().value!;
    const oldestPool = this.pools.get(oldest);
    this.clients.delete(oldest);
    this.pools.delete(oldest);
    void oldestPool?.end();
  }

  getTenantDb(schemaName: string) {
    if (this.clients.has(schemaName)) {
      this.touch(schemaName);
      return this.clients.get(schemaName)!;
    }

    this.evictOldestIfNeeded();

    const pool = new Pool({
      connectionString: this.connectionString,
      max: TENANT_POOL_MAX_CONNECTIONS,
      options: `-c search_path=${schemaName},public`,
    });
    const db = drizzle(pool, { schema: tenantSchema });
    this.clients.set(schemaName, db);
    this.pools.set(schemaName, pool);
    return db;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.pools.values()].map((pool) => pool.end()));
    this.pools.clear();
    this.clients.clear();
  }
}
