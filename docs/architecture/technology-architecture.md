# Technology Architecture

## Stack

| Layer | Technology |
|---|---|
| Runtime framework | NestJS 11 (Express HTTP adapter, serving only `GET /health`) |
| Language | TypeScript |
| Graph execution | `@langchain/langgraph` + `@langchain/core` (`StateGraph`) |
| Concurrency isolation | Node.js `node:worker_thread`, one per execution |
| Database | PostgreSQL 18 |
| ORM / migrations | Drizzle ORM (`drizzle-orm/node-postgres`) + `drizzle-kit` |
| DB driver | `pg` (`Pool`) |
| Queueing | Postgres table + `SELECT ... FOR UPDATE SKIP LOCKED` (no external queue) |
| Progress transport | Postgres `pg_notify`/`LISTEN` (no external pub/sub) |
| Lint | ESLint (`eslint.config.mjs`) |
| Formatting | Prettier |
| Unit/integration tests | Jest, run serially (`maxWorkers: 1`, see
  [`learnings/`](../learnings/postgres.md) context on shared-table test races) |

## Runtime

Single Node.js process per instance. `src/main.ts` boots via `NestFactory.create(AppModule)` and
listens on `PORT` (default 4000), but the only route mounted is `GET /health` — the process's
real job is still running the poll loop (`AppModule.onModuleInit()`) until terminated, not serving
HTTP traffic. `/health` returns `{ status: 'ok', lastHeartbeatAt: <ISO timestamp> }`, where
`lastHeartbeatAt` is updated once a second by `HeartbeatService` on its own timer, independent of
the poll loop's iteration cadence (a long-running job would otherwise make a healthy engine look
stale). `app.enableShutdownHooks()` wires `onModuleDestroy()` to `SIGTERM`/`SIGINT`. Horizontal
scaling is done by running multiple instances against the same Postgres database — safe because
job claiming is race-safe (see [ADR-0002](ADR/0002-postgres-select-for-update-skip-locked-job-queue.md)).
Each instance's `/health` only reflects its own heartbeat, not the fleet's.

## Local infrastructure

`docker-compose.yml` runs a single `postgres:18` container (host port `5433`), the only external
dependency. See [`user-guides/config.md`](../user-guides/config.md) and
[`learnings/postgres.md`](../learnings/postgres.md) for the `postgres:18` volume-mount detail.

## Environments

- **Dev** — `npm run start:dev` (watch mode) against the compose Postgres container.
- No test, staging, or production deployment tooling (Dockerfile, CI config, deploy script)
  exists in this repository yet.
