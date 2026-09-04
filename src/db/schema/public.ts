import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

// Hand-maintained mirror of home's own server/db/schema/public.ts `tenants`
// table - owned and migrated by home, never by flow-engine. Only the
// columns flow-engine actually reads are included.
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  schemaName: text('schema_name').notNull().unique(),
});
