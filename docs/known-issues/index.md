# Known issues

## Orphaned `running`-status jobs are never recovered

**Where**: `src/jobs/job-claim.service.ts` (`claimNext()`/`fail()`/`complete()`),
`src/app.module.ts` (`onModuleDestroy()`, `app.enableShutdownHooks()`).

**Issue**: once `claimNext()` marks a job `running`, nothing ever moves it out of that state
except a normal `complete()`/`fail()` call at the end of `ExecutionOrchestratorService.processNext()`.
If the process is killed while a job is claimed — a crash, an OOM kill, a forced `docker stop`
without graceful shutdown, or even a graceful shutdown that doesn't wait for an in-flight
`processNext()` call to finish — the job stays `running` forever. There is no reaper, no
lease-expiry timestamp, and no heartbeat mechanism.

**Current impact**: any abnormal or even normal-but-mid-job process exit leaves that one job
permanently stuck; nothing automatically detects or retries it. Requires a manual database query
and update to notice and fix. No automated recovery exists today.

**Fix, if/when it matters**: see the "Orphaned `running`-status job recovery" entry in
[`../backlog.md`](../backlog.md) for the deferred design (lease-expiry timestamp or heartbeat,
plus a reaper).

## Execution has no timeout

**Where**: `src/worker/worker-runner.service.ts` (`run()`).

**Issue**: a spawned `worker_thread` running a graph has no wall-clock timeout. A hung worker
(infinite loop, deadlocked call to an LLM provider) that neither crashes nor exits leaves the
orchestrator's `for await` loop waiting indefinitely, holding that job `running` (see the item
above) and tying up engine capacity.

**Current impact**: low today — every `llm` node is still backed by `FakeLlmProvider`, so there's
no real network call that can hang. Becomes a real risk once a real `LlmProviderPort`
implementation is wired in.

**Fix, if/when it matters**: see the "Execution timeout for worker_thread-based graph runs" entry
in [`../backlog.md`](../backlog.md).

## Graph execution always uses `FakeLlmProvider`

**Where**: `src/worker/graph-execution.worker.ts`.

**Issue**: the worker hardcodes `new FakeLlmProvider()` regardless of the `provider` field
(`anthropic`/`openai`/`google`) on the graph's `llm` node
(`src/graph/graph-definition.types.ts`). No real `LlmProviderPort` implementation exists yet.

**Current impact**: the engine cannot produce real LLM output in any environment; every run
returns `FakeLlmProvider`'s canned tokens.

**Fix, if/when it matters**: implement `LlmProviderPort` per provider (keyed by
`node.data.provider`) and select it in the worker instead of the hardcoded fake — not yet
tracked as a dated backlog item.

