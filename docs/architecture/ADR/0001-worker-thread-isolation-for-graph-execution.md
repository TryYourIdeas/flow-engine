# ADR-0001: Run graph execution in an isolated `worker_thread`

## Status

Accepted (2026-08-27)

## Context

`GraphInterpreter` compiles a tenant-supplied `GraphDefinition` into a `@langchain/langgraph`
`StateGraph` and invokes it, calling out to an LLM provider per `llm` node. This code runs a
job at a time, driven by `ExecutionOrchestratorService.processNext()` inside the same Node
process that also runs the job-polling loop.

Running that execution directly in the main process/event loop would mean: a single job's
synchronous work (or a future custom-JS tool node, referenced as a later phase in the design
this repo implements) can block the event loop and stall the poll loop and every other
concurrent job; an unhandled crash inside graph execution takes down the whole engine process,
not just that one job; and there is no process-level boundary to eventually cap a single
execution's memory/CPU.

## Decision

Run each job's graph execution inside a dedicated `node:worker_thread`
(`src/worker/graph-execution.worker.ts`, spawned per-execution by `WorkerRunnerService`,
`src/worker/worker-runner.service.ts`). The worker communicates back to the main thread purely
via `postMessage` (`WorkerMessage`: `token`/`done`/`error`), consumed as an `AsyncGenerator` by
the caller. `WorkerRunnerService` also treats an unexpected `exit` (worker died without posting
`done`/`error`) and non-`Error` throws inside the worker as error messages, so the orchestrator
never hangs waiting on a dead worker.

Rejected alternative: running `GraphInterpreter` in-process. Simpler (no message-passing
boundary, no serialization of `GraphDefinition`/results), but gives up thread-level isolation —
a hang or crash in one execution directly affects the poll loop and every other job.

## Consequences

- Every value crossing the worker boundary (`workerData` in, `WorkerMessage` out) must be
  structured-cloneable; `GraphDefinition` and `WorkerMessage` are plain JSON-shaped data today,
  so this hasn't required extra care yet, but a future tool node with non-serializable state
  would need a different design.
- One `worker_thread` is spawned and torn down per execution — no pooling or reuse. Acceptable
  at current volume; tracked as a backlog item (`docs/backlog.md`) once real throughput is
  measured.
- Isolation is currently thread-level, not process-level: a worker still shares the parent
  process's memory space and has no `resourceLimits` cap (also tracked in `docs/backlog.md`).
  It stops a hang from blocking the main event loop, but does not cap a runaway worker's
  memory/CPU consumption.
- No execution timeout exists yet — a hung worker (no crash, no exit) leaves
  `WorkerRunnerService.run()`'s generator waiting forever. See
  `docs/known-issues/index.md` and the corresponding `docs/backlog.md` entry.
