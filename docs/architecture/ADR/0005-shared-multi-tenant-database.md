# ADR-0005: Shared multi-tenant database with home

## Status

Accepted

## Context

Since the original design (ADR-0001–0004), `flow-engine` owned a single cross-tenant `jobs` table
in its own dedicated Postgres database, separate from `home`'s. `home` had to write into it via a
cross-database client with a hand-mirrored schema (see `home`'s
`docs/architecture/ADR/0007-cross-database-writes-for-flow-engine-jobs.md`), and submitting an
inbox task's form was two non-atomic writes across two databases.

The actual deployment reality is simpler: `flow-engine` and `home` run against the **same**
Postgres instance, and each tenant already has its own schema there (`home`'s tenant-per-schema
model). Execution jobs and durable inbox tasks are naturally just more tenant tables, not a
separate cross-tenant concern — see `home`'s
`docs/architecture/ADR/0008-shared-multi-tenant-database-for-flow-engine.md` for the full decision
record (this ADR is `flow-engine`'s side of the same change).

## Decision

- `flow_jobs` and `inbox_tasks` are owned and migrated by `home` (`server/db/schema/tenant.ts`),
  not `flow-engine`. `flow-engine` keeps a hand-maintained mirror of their shape
  (`src/db/schema/tenant.ts`) purely for its own typed queries — the same "hand-mirrored, one side
  owns it" pattern already used for `LlmProviderPort` and the old cross-database jobs mirror,
  just now inside one shared database instead of across two.
- `TenantDbFactory` (`src/db/tenantDb.ts`) caches a small connection pool per tenant schema
  (`search_path` fixed at the Postgres startup-parameter level), mirroring `home`'s own
  `getTenantDb()`. `JobClaimService` and `TenantInboxTaskWriter` both take a `schemaName` and go
  through this factory instead of a single shared connection.
- `TenantRegistryService` (`src/tenants/tenant-registry.service.ts`) queries `home`'s
  `public.tenants` table (hand-mirrored in `src/db/schema/public.ts`) to discover which schemas
  exist. `ExecutionOrchestratorService.processNext()` round-robins `JobClaimService.claimNext()`
  across those schemas (starting after whichever schema yielded work last time) instead of
  claiming from one global table — see ADR-0002's update note.
- LangGraph's `PostgresSaver` is constructed per-run with `{ schema: job.schemaName }`
  (`@langchain/langgraph-checkpoint-postgres` supports a `schema` option), so its own
  `checkpoints`/`checkpoint_writes` tables (managed by the library's own `setup()`, not by
  `home`'s Drizzle migrations) live inside that tenant's schema too.
- `TenantInboxTaskWriter` (`src/graph/tenant-inbox-task-writer.ts`) is now the real, production
  `InboxTaskPort` implementation — it writes directly into the correct tenant's `inbox_tasks` table
  using the same `TenantDbFactory` connection already held for job claiming. This resolves the
  "Real `InboxTaskPort` implementation" backlog item, which was blocked on a separate cross-database
  credential model that this shared-database design no longer needs.
- `flow-engine` keeps its own dedicated Postgres instance and migrations (`src/db/migrations/`,
  `docker-compose.yml`) purely for its own isolated unit/integration tests — a minimal
  `tenants` + tenant-schema shape it seeds itself (`src/db/test/seed.ts`'s
  `ensureTenantSchema()`/`seedTenant()`/`seedFlowJob()`), decoupled from needing `home`'s real
  migrations to run first. Production connects to `home`'s actual database.

## Consequences

- `flow-engine` and `home` are now coupled at the database schema level: a change to
  `flow_jobs`/`inbox_tasks`'s shape is a `home`-owned migration that `flow-engine`'s hand-mirrored
  `src/db/schema/tenant.ts` must be updated to match by hand, in the same PR/release — there's no
  schema-mirroring seam left to absorb drift silently, which cuts both ways.
- Per-tenant `TenantDbFactory` pools and `PostgresSaver` instances mean resource usage scales with
  the number of *active* tenants touched recently, not with total job volume — bounded by the
  factory's LRU cache (`TENANT_POOL_CACHE_SIZE`), same design as `home`'s own tenant pool cache.
- `flow-engine`'s exact Postgres role/credential scoping against `home`'s database (least-privilege
  vs. reusing `home`'s own connection string verbatim) is an operational decision for deployment,
  not resolved by this ADR.
