# Configuration

All configuration is supplied via environment variables. Copy `.env.example` to `.env` for local
development.

## Required

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string. In production, this is **home's own database** (see [ADR-0005](../architecture/ADR/0005-shared-multi-tenant-database.md)) — flow-engine reads home's `public.tenants` table and connects to each tenant's own schema for its `flow_jobs`/`inbox_tasks` tables and LangGraph checkpoint tables; it owns and migrates none of them. Local dev/tests use flow-engine's own disposable Postgres instead (matches `docker-compose.yml`): `postgres://flow_engine:flow_engine@localhost:5433/flow_engine`. If unset, `src/app.module.ts` falls back to this same local-dev default rather than failing at boot — there is no boot-time validation that a real value was provided. |

No other environment variables are read by the application today. The `provider` field on an
`llm` graph node (`anthropic` / `openai` / `google`, see
[`features.md`](features.md#graph-execution)) is not yet backed by real per-provider API keys —
execution currently always uses `FakeLlmProvider` (see
[`known-issues/index.md`](../known-issues/index.md)).

## Local Postgres

`docker-compose.yml` starts a `postgres:18` container on host port `5433` (mapped from the
container's `5432`, matching `DATABASE_URL` above) for flow-engine's own isolated dev/test use —
not a stand-in for home's real database. See [`learnings/postgres.md`](../learnings/postgres.md)
for a `postgres:18`-specific volume-mount gotcha if you change this file.

```bash
docker compose up -d
npm run db:migrate
```
