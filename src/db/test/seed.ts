import { sql } from 'drizzle-orm';
import { createDb } from '../client';
import { tenants } from '../schema/public';
import { flowJobs } from '../schema/tenant';
import { TenantDbFactory } from '../tenantDb';

export function testDb() {
  const connectionString =
    process.env.DATABASE_URL ??
    'postgres://flow_engine:flow_engine@localhost:5433/flow_engine';
  return createDb(connectionString);
}

export function testTenantDbFactory() {
  const connectionString =
    process.env.DATABASE_URL ??
    'postgres://flow_engine:flow_engine@localhost:5433/flow_engine';
  return new TenantDbFactory(connectionString);
}

export async function seedTenant(
  db: ReturnType<typeof createDb>['db'],
  overrides: Partial<typeof tenants.$inferInsert> = {},
) {
  const [row] = await db
    .insert(tenants)
    .values({
      slug: `tenant-${Math.random().toString(36).slice(2, 10)}`,
      schemaName: `tenant_test_${Math.random().toString(36).slice(2, 10)}`,
      ...overrides,
    })
    .returning();
  return row;
}

export async function clearTenants(db: ReturnType<typeof createDb>['db']) {
  await db.delete(tenants);
}

/**
 * Creates a tenant schema (if missing) with the minimal flow_jobs/inbox_tasks
 * shape flow-engine needs - a local stand-in for home's real tenant
 * migrations, matching this project's existing "seed its own local test
 * schemas ... does not block on home's migrations landing" philosophy (see
 * docs/superpowers/plans/2026-08-27-flow-engine-core.md).
 */
export async function ensureTenantSchema(schemaName: string) {
  const { db, pool } = testDb();
  try {
    await createTenantSchemaAndTables(db, schemaName);
  } finally {
    await pool.end();
  }
}

async function createTenantSchemaAndTables(
  db: ReturnType<typeof createDb>['db'],
  schemaName: string,
) {
  await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`));
  await db.execute(
    sql.raw(`
    CREATE TABLE IF NOT EXISTS "${schemaName}".flow_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      type text NOT NULL,
      graph_id uuid NOT NULL,
      user_id uuid NOT NULL,
      run_id uuid,
      input jsonb,
      status text NOT NULL DEFAULT 'pending',
      error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `),
  );
  await db.execute(
    sql.raw(`
    CREATE TABLE IF NOT EXISTS "${schemaName}".inbox_tasks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id uuid NOT NULL,
      node_id text NOT NULL,
      assignee_user_id uuid NOT NULL,
      prompt text NOT NULL,
      fields jsonb NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      input jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz
    )
  `),
  );
}

export async function seedFlowJob(
  tenantDbFactory: TenantDbFactory,
  schemaName: string,
  overrides: Partial<typeof flowJobs.$inferInsert> = {},
) {
  const db = tenantDbFactory.getTenantDb(schemaName);
  const [row] = await db
    .insert(flowJobs)
    .values({
      type: 'run',
      graphId: overrides.graphId ?? '11111111-1111-1111-1111-111111111111',
      userId: overrides.userId ?? '22222222-2222-2222-2222-222222222222',
      status: 'pending',
      ...overrides,
    })
    .returning();
  return row;
}

export async function clearTenantSchema(
  tenantDbFactory: TenantDbFactory,
  schemaName: string,
) {
  const db = tenantDbFactory.getTenantDb(schemaName);
  await db.execute(sql`DELETE FROM inbox_tasks`);
  await db.execute(sql`DELETE FROM flow_jobs`);
}
