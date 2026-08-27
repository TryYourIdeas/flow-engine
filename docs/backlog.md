# Backlog

## Execution timeout for worker_thread-based graph runs

**Description:** `WorkerRunnerService` has no timeout — if a worker hangs (infinite loop, deadlocked
call) without crashing or exiting, `run()`'s generator waits forever. The design doc
(`docs/superpowers/plans/2026-08-27-flow-engine-core.md` in the `agent-builder` repo) and the
Phase 4 execution-panel spec call for a 30-minute wall-clock timeout, not yet implemented here.

**Value:** Prevents a single hung execution from tying up a worker thread indefinitely and consuming
engine capacity that should go to other tenants' runs.

**Consequence of not having it:** Under real load, hung executions accumulate and degrade
throughput for all tenants sharing the engine, with no automatic recovery.

## Worker pooling / reuse

**Description:** Currently one `worker_thread` is spawned and torn down per execution. No pooling
or reuse strategy exists yet.

**Value:** Reduces per-execution spawn overhead once the orchestrator is polling and running many
executions per minute.

**Consequence of not having it:** Higher latency and CPU overhead per execution than a pooled
approach; likely fine at low volume, worth revisiting once real throughput is measured.

## `resourceLimits` on spawned workers

**Description:** `Worker` construction in `worker-runner.service.ts` does not set `resourceLimits`
(memory/CPU caps). Especially relevant once untrusted custom-JS tool nodes are added in a later
phase (not part of this plan).

**Value:** Caps the blast radius of a single execution consuming excessive memory/CPU on the host
process.

**Consequence of not having it:** A single execution (buggy or, later, malicious) could exhaust
host resources shared by other concurrent executions.

## Orphaned `running`-status job recovery

**Description:** If the process is killed while a job is claimed (`status = 'running'`) — a crash,
an OOM kill, a forced `docker stop` without graceful shutdown, or even a graceful shutdown (see
`main.ts`'s `app.enableShutdownHooks()` and `AppModule`'s `onModuleDestroy()`) that doesn't wait
for an in-flight `processNext()` call to finish — nothing ever requeues or fails that job. It stays
`running` forever. There is no reaper process, lease-expiry timestamp, or heartbeat mechanism to
detect and recover stuck jobs. Graceful shutdown reduces but does not eliminate this risk: it only
stops new poll iterations from starting, and a hard kill (SIGKILL, OOM) bypasses shutdown hooks
entirely regardless.

**Value:** Prevents jobs from being silently stuck in `running` state forever after an abnormal or
even a normal-but-mid-job process exit, which would otherwise require manual database intervention
to notice and fix.

**Consequence of not having it:** Under real-world operational conditions (deploys, crashes, OOM
kills), `running` jobs will accumulate that never complete and are never retried, with no automated
way to detect or recover them short of a manual database query and update.
