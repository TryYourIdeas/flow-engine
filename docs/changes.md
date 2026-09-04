# Changes

Summary of work done, most recent first.

## 2026-09-04 — Shared multi-tenant database with home

Replaced the single cross-tenant `jobs` table (and flow-engine's own dedicated Postgres database)
with a per-tenant `flow_jobs` table living in home's own database — flow-engine now connects to
the same Postgres instance as home and resolves a tenant-scoped connection per job
(`TenantDbFactory`), discovering which tenants have pending work via a new `TenantRegistryService`
that queries home's `public.tenants` table. `ExecutionOrchestratorService` round-robins job
claiming across tenant schemas instead of claiming from one global table. LangGraph's
`PostgresSaver` checkpoint tables now live per-tenant-schema too. `TenantInboxTaskWriter` replaces
`FakeInboxTaskWriter` as the real, production `InboxTaskPort` implementation — resolving that
backlog item, since flow-engine already holds a tenant-scoped connection for job claiming. Also
fixed a pre-existing bug where `AppModule` never actually provided a value for the orchestrator's
inbox-writer dependency, so the module would have thrown on boot in production. See
[ADR-0005](architecture/ADR/0005-shared-multi-tenant-database.md) and home's
[ADR-0008](../../home/docs/architecture/ADR/0008-shared-multi-tenant-database-for-flow-engine.md).

## 2026-09-04 — Form node engine support

Generalized `GraphInterpreter` from a single hardcoded `llm` node to walking an arbitrary
multi-node graph, and added a `form` node type that pauses execution via LangGraph `interrupt()`,
checkpoints via `PostgresSaver`, and resumes via a new `resume` job type. See
[ADR-0004](architecture/ADR/0004-langgraph-interrupt-resume-for-form-hitl-nodes.md) and
`home/docs/superpowers/specs/2026-09-04-flow-builder-form-node-design.md`.

## 2026-08-27 (initial engine build: job queue, worker-isolated graph execution, progress streaming)

- **Scaffolded the project**: NestJS starter (`config: initial NestJS scaffold`), no HTTP
  controllers — it runs as an application context only (`src/main.ts`).
- **Postgres-backed job queue**: added the `jobs` table via Drizzle
  (`src/db/schema/public.ts`) and race-safe claiming across multiple engine instances using
  `SELECT ... FOR UPDATE SKIP LOCKED` (`src/jobs/job-claim.service.ts`). See
  [ADR-0002](architecture/ADR/0002-postgres-select-for-update-skip-locked-job-queue.md).
- **Graph execution engine**: `GraphDefinition`/`LlmProviderPort` types
  (`src/graph/graph-definition.types.ts`, `src/graph/llm-provider.port.ts`) and a
  `GraphInterpreter` (`src/graph/graph-interpreter.ts`) that compiles a definition into a
  `@langchain/langgraph` `StateGraph` — currently supports exactly one `llm` node. Buffers all
  tokens until `graph.invoke()` resolves rather than streaming incrementally; documented as a
  known tradeoff pending real streaming support (`4c82cee`).
- **Worker-thread isolation**: graph execution moved into an isolated `node:worker_thread`
  (`src/worker/graph-execution.worker.ts`, `src/worker/worker-runner.service.ts`), with handling
  for unexpected worker exit and non-`Error` throws. See
  [ADR-0001](architecture/ADR/0001-worker-thread-isolation-for-graph-execution.md).
- **Progress streaming via `pg_notify`**: `ProgressPublisherService`
  (`src/progress/progress-publisher.service.ts`) publishes each worker message to a
  `run:<jobId>` Postgres NOTIFY channel; switched from manually-escaped `NOTIFY` strings to
  `pg_notify()` (`5bab6ef`) to avoid injection/escaping bugs. See
  [ADR-0003](architecture/ADR/0003-postgres-notify-for-progress-streaming.md).
- **Orchestration wiring**: `ExecutionOrchestratorService`
  (`src/orchestrator/execution-orchestrator.service.ts`) ties claim → worker run → progress
  publish → complete/fail together, with care taken not to double-report a failure that was
  already persisted (`alreadyFailed` guard, `a48896a`).
- **Startup poll loop**: `AppModule.onModuleInit()` runs a continuous poll loop calling
  `processNext()` (`673379d`), recovers from per-iteration errors instead of crashing the loop
  (`0bd1c1c`), and stops accepting new iterations on `onModuleDestroy()` via
  `app.enableShutdownHooks()` (`84d015d`) — though an in-flight job is not waited on; see
  [`known-issues/index.md`](known-issues/index.md).
- **Postgres pool crash fix**: `pool.on('error', ...)` added in `src/db/client.ts` so a lost idle
  connection (server restart, network blip) logs instead of crashing the process (`2df4d74`).
- **Test stability**: flow-engine's Jest suite runs serially (`8d9870e`) to avoid cross-suite races
  on the shared `jobs` table, and a stale/hazardous e2e spec was removed (`0bd1c1c`).
