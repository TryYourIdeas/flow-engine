"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testDb = testDb;
exports.testTenantDbFactory = testTenantDbFactory;
exports.seedTenant = seedTenant;
exports.clearTenants = clearTenants;
exports.ensureTenantSchema = ensureTenantSchema;
exports.seedFlowJob = seedFlowJob;
exports.clearTenantSchema = clearTenantSchema;
const drizzle_orm_1 = require("drizzle-orm");
const client_1 = require("../client");
const public_1 = require("../schema/public");
const tenant_1 = require("../schema/tenant");
const tenantDb_1 = require("../tenantDb");
function testDb() {
    const connectionString = process.env.DATABASE_URL ??
        'postgres://flow_engine:flow_engine@localhost:5433/flow_engine';
    return (0, client_1.createDb)(connectionString);
}
function testTenantDbFactory() {
    const connectionString = process.env.DATABASE_URL ??
        'postgres://flow_engine:flow_engine@localhost:5433/flow_engine';
    return new tenantDb_1.TenantDbFactory(connectionString);
}
async function seedTenant(db, overrides = {}) {
    const [row] = await db
        .insert(public_1.tenants)
        .values({
        slug: `tenant-${Math.random().toString(36).slice(2, 10)}`,
        schemaName: `tenant_test_${Math.random().toString(36).slice(2, 10)}`,
        ...overrides,
    })
        .returning();
    return row;
}
async function clearTenants(db) {
    await db.delete(public_1.tenants);
}
async function ensureTenantSchema(schemaName) {
    const { db, pool } = testDb();
    try {
        await createTenantSchemaAndTables(db, schemaName);
    }
    finally {
        await pool.end();
    }
}
async function createTenantSchemaAndTables(db, schemaName) {
    await db.execute(drizzle_orm_1.sql.raw(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`));
    await db.execute(drizzle_orm_1.sql.raw(`
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
  `));
    await db.execute(drizzle_orm_1.sql.raw(`
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
  `));
}
async function seedFlowJob(tenantDbFactory, schemaName, overrides = {}) {
    const db = tenantDbFactory.getTenantDb(schemaName);
    const [row] = await db
        .insert(tenant_1.flowJobs)
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
async function clearTenantSchema(tenantDbFactory, schemaName) {
    const db = tenantDbFactory.getTenantDb(schemaName);
    await db.execute((0, drizzle_orm_1.sql) `DELETE FROM inbox_tasks`);
    await db.execute((0, drizzle_orm_1.sql) `DELETE FROM flow_jobs`);
}
//# sourceMappingURL=seed.js.map