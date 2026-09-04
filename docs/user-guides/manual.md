# Manual — running flow-engine

## Local setup

```bash
npm install
docker compose up -d      # starts postgres:18 on localhost:5433
npm run db:migrate        # applies drizzle migrations
npm run start:dev         # boots the poll loop, watch mode
```

Set `DATABASE_URL` in `.env` if you're not using the `docker-compose.yml` defaults — see
[`config.md`](config.md).

There is no HTTP endpoint to call. The process starts, immediately begins round-robin polling
each tenant's own `flow_jobs` table (discovered via home's `public.tenants` — see
[ADR-0005](../architecture/ADR/0005-shared-multi-tenant-database.md)), and runs until stopped
(`SIGTERM`/`SIGINT` trigger `app.enableShutdownHooks()`, which stops new poll iterations but does
not wait for an in-flight job — see [`known-issues/index.md`](../known-issues/index.md)). Note
`DATABASE_URL` here must point at home's database for a tenant to actually be found — this local
setup's own `docker-compose.yml` Postgres has no `tenants` row by default, so a freshly cloned
checkout polling only that database will just idle.

## Queuing a job

Insert a row into a tenant's own `flow_jobs` table (i.e. `home`'s
`POST /api/flow-builder/graphs/[id]/run` does this on your behalf in practice) with
`status = 'pending'`, `type = 'run'`, and an `input` matching `WorkerData`
(`{ definition: GraphDefinition, input: { input: string } }`, see
[`features.md`](features.md#graph-execution)). The engine picks it up on its next poll
iteration (at most ~1s later if every tenant's queue was idle).

## Job lifecycle

```mermaid
sequenceDiagram
    participant Caller as Upstream app (home)
    participant DB as Postgres (tenant's flow_jobs table)
    participant Engine as flow-engine poll loop
    participant Worker as worker_thread
    participant Notify as pg_notify (run:&lt;jobId&gt;)

    Caller->>DB: INSERT flow_jobs (status='pending')
    loop poll loop (round-robin across tenant schemas)
        Engine->>DB: UPDATE ... WHERE status='pending' FOR UPDATE SKIP LOCKED
        DB-->>Engine: claimed job (status now 'running')
    end
    Engine->>Worker: spawn worker_thread(definition, input, schemaName)
    Worker->>Worker: GraphInterpreter.run() via LangGraph
    loop per token
        Worker-->>Engine: postMessage({kind:'token', ...})
        Engine->>Notify: pg_notify('run:<jobId>', message)
    end
    alt success
        Worker-->>Engine: postMessage({kind:'done'})
        Engine->>Notify: pg_notify('run:<jobId>', {kind:'done'})
        Engine->>DB: UPDATE flow_jobs SET status='completed'
    else worker error
        Worker-->>Engine: postMessage({kind:'error', message})
        Engine->>Notify: pg_notify('run:<jobId>', {kind:'error', ...})
        Engine->>DB: UPDATE flow_jobs SET status='failed', error=...
    end
    Caller->>Notify: LISTEN "run:<jobId>" (subscribed before/while running)
```

## Watching progress

From `psql` (or any Postgres client), for a job whose id you know:

```sql
LISTEN "run:<jobId>";
```

Each `NOTIFY` payload is the JSON-stringified `WorkerMessage`
(`{kind:'token', nodeId, token}` / `{kind:'done'}` / `{kind:'error', message}`).
