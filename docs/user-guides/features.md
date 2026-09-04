# Features

`flow-engine` is a standalone NestJS worker process (no HTTP surface — it boots via
`NestFactory.createApplicationContext`) that executes LangGraph-based agent flows queued by
another application (e.g. `agent-builder`/`home`'s `/flow-builder`) and streams progress back
over Postgres. It has no UI or API of its own; "the user" here is an operator running the process
and the upstream apps that enqueue `jobs` rows and subscribe to progress.

## Job queue and claiming

- Work is queued as rows in the Postgres `jobs` table (`src/db/schema/public.ts`): `type`
  (`run`/`resume`), `tenantId`, `userId`, `graphId`, optional `runId`, a `jsonb input`, and a
  `status` (`pending` → `running` → `completed`/`failed`).
- `AppModule.onModuleInit()` starts a tight poll loop (`src/app.module.ts`) that calls
  `ExecutionOrchestratorService.processNext()` continuously — no delay when a job was just
  processed, a 1s backoff when the queue was empty — until `onModuleDestroy()` sets a stop flag.
- `JobClaimService.claimNext()` (`src/jobs/job-claim.service.ts`) claims the oldest pending job
  race-safely across multiple engine instances using a single
  `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)` statement — see
  [ADR-0002](../architecture/ADR/0002-postgres-select-for-update-skip-locked-job-queue.md).

## Graph execution

- `GraphDefinition` (`src/graph/graph-definition.types.ts`) is a minimal node/edge graph. Today
  only a single `llm` node type exists, with `systemPrompt`, `provider`
  (`anthropic`/`openai`/`google`), `model`, and `temperature`.
- `GraphInterpreter` (`src/graph/graph-interpreter.ts`) compiles the definition into a
  `@langchain/langgraph` `StateGraph` and runs it against an `LlmProviderPort`. It currently
  supports **exactly one** `llm` node — multi-node graphs throw.
- Execution runs inside an isolated `node:worker_thread`
  (`src/worker/graph-execution.worker.ts`, spawned by `WorkerRunnerService`), not in the main
  process — see
  [ADR-0001](../architecture/ADR/0001-worker-thread-isolation-for-graph-execution.md). The
  worker currently always uses `FakeLlmProvider` (`src/graph/fake-llm-provider.ts`); wiring a
  real provider keyed by `node.data.provider` is not yet implemented.

## Progress streaming

- As the worker produces `token` / `done` / `error` messages, `ExecutionOrchestratorService`
  publishes each one to a Postgres `pg_notify` channel named `run:<jobId>`
  (`src/progress/progress-publisher.service.ts`) — see
  [ADR-0003](../architecture/ADR/0003-postgres-notify-for-progress-streaming.md). A consuming
  app subscribes with `LISTEN "run:<jobId>"` to relay tokens to a client in real time.

## Job completion

- On a clean run, the job is marked `completed`. On a worker-reported `error` message or any
  other failure during processing, the job is marked `failed` with the error text stored in
  `jobs.error`. Both paths are handled by `ExecutionOrchestratorService.processNext()`
  (`src/orchestrator/execution-orchestrator.service.ts`), which is careful not to double-report a
  failure that already made it to the database (see the inline comment on `alreadyFailed`).
- Only `run` jobs are handled today; a `resume` job (for the currently-unimplemented pause/resume
  flow) throws.
