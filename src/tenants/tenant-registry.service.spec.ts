import { TenantRegistryService } from './tenant-registry.service';
import { testDb, seedTenant, clearTenants } from '../db/test/seed';

describe('TenantRegistryService', () => {
  const { db, pool } = testDb();
  const service = new TenantRegistryService(db);

  afterEach(async () => {
    await clearTenants(db);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('lists tenant schema names in a stable order', async () => {
    await seedTenant(db, { slug: 'zeta', schemaName: 'tenant_zeta' });
    await seedTenant(db, { slug: 'alpha', schemaName: 'tenant_alpha' });

    const schemas = await service.listTenantSchemas();

    expect(schemas).toEqual(['tenant_alpha', 'tenant_zeta']);
  });

  it('returns an empty list when there are no tenants', async () => {
    const schemas = await service.listTenantSchemas();
    expect(schemas).toEqual([]);
  });
});
