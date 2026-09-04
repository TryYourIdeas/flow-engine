# ADR 0004: LangGraph `interrupt()`/`Command(resume)` + `PostgresSaver` for form/HITL nodes

## Status
Accepted

## Context
The Form node (see `home/docs/superpowers/specs/2026-09-04-flow-builder-form-node-design.md`) needs
to pause a run for human input that can take minutes to days, and resume on any engine instance
without the original worker still being alive. The prior architecture doc
(`agent-builder/docs/superpowers/specs/2026-08-27-execution-engine-architecture-design.md`, Section
2.5) already chose LangGraph's checkpointing primitives for this; this ADR records the concrete
implementation.

## Decision
`GraphInterpreter` calls LangGraph's `interrupt()` inside a `form` node's handler. The interpreter
is constructed with a `BaseCheckpointSaver` (`PostgresSaver`, one per worker, connected to the same
Postgres instance as the `jobs` table) and a `runId` used as the LangGraph `thread_id`. On
interrupt, `compiled.invoke()` returns a value satisfying `isInterrupted()` instead of the graph's
normal output; the interpreter yields an `interrupted` event instead of completing. The
orchestrator treats this as a new terminal outcome per job: it writes a durable inbox task (via
`InboxTaskPort`) and marks the job `waiting` rather than `completed`. A later `resume`-type job
loads the same checkpoint by `runId` and calls `Command({ resume: values })`, letting `interrupt()`
return the submitted values to the paused node instead of throwing.

## Consequences
- `GraphInterpreter.run()` takes an explicit `runId` (new required parameter) — every run, not just
  ones that pause, must have one, so `runId ?? job.id` is used for fresh `run` jobs.
- The worker calls `checkpointer.setup()` on every spawn, which is idempotent but wasteful once
  workers run at any real throughput — tracked in `docs/backlog.md` as a follow-up (move it to
  app bootstrap, run once).
- `InboxTaskPort`'s only implementation today is `FakeInboxTaskWriter` — see
  `docs/known-issues/index.md`.
