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

There is no HTTP endpoint to call. The process starts, immediately begins polling the `jobs`
table, and runs until stopped (`SIGTERM`/`SIGINT` trigger `app.enableShutdownHooks()`, which
stops new poll iterations but does not wait for an in-flight job — see
[`known-issues/index.md`](../known-issues/index.md)).

## Queuing a job

Insert a row into `jobs` with `status = 'pending'`, `type = 'run'`, and an `input` matching
`WorkerData` (`{ definition: GraphDefinition, input: { input: string } }`, see
[`features.md`](features.md#graph-execution)). The engine picks it up on its next poll
iteration (at most ~1s later if the queue was idle).

## Job lifecycle

```mermaid
sequenceDiagram
    participant Caller as Upstream app
    participant DB as Postgres (jobs table)
    participant Engine as flow-engine poll loop
    participant Worker as worker_thread
    participant Notify as pg_notify (run:&lt;jobId&gt;)

    Caller->>DB: INSERT jobs (status='pending')
    loop poll loop
        Engine->>DB: UPDATE ... WHERE status='pending' FOR UPDATE SKIP LOCKED
        DB-->>Engine: claimed job (status now 'running')
    end
    Engine->>Worker: spawn worker_thread(definition, input)
    Worker->>Worker: GraphInterpreter.run() via LangGraph
    loop per token
        Worker-->>Engine: postMessage({kind:'token', ...})
        Engine->>Notify: pg_notify('run:<jobId>', message)
    end
    alt success
        Worker-->>Engine: postMessage({kind:'done'})
        Engine->>Notify: pg_notify('run:<jobId>', {kind:'done'})
        Engine->>DB: UPDATE jobs SET status='completed'
    else worker error
        Worker-->>Engine: postMessage({kind:'error', message})
        Engine->>Notify: pg_notify('run:<jobId>', {kind:'error', ...})
        Engine->>DB: UPDATE jobs SET status='failed', error=...
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
