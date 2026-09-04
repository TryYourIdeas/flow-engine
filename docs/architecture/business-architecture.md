# Business Architecture

## Purpose

`flow-engine` executes tenant-authored LangGraph agent flows asynchronously and streams their
progress back, so an upstream application (e.g. `home`'s `/flow-builder`, formerly the
standalone `agent-builder`) can offer "run this graph" without hosting the execution runtime
itself.

## Capability

- Accept a queued execution request (`run` a graph, or `resume` a paused one) scoped to a tenant
  (via which tenant schema the request row lives in), `userId`, `graphId`.
- Execute a multi-node graph definition (`llm` and `form` node types) and report its result
  (`completed`/`failed`/`waiting`) back to the queue.
- Pause on a `form` node, durably recording the pending human input as an inbox task in that same
  tenant's schema, and resume from a checkpoint once answered.
- Stream token-level progress for a run to any subscriber in real time.

## Actors

- **Upstream application** (`home`) — enqueues `flow_jobs` rows (in its own tenant schemas) and
  subscribes to a run's `pg_notify` channel to relay progress to its own end users. `flow-engine`
  has no UI, API, or authentication of its own; it trusts whatever inserted the row, and shares
  `home`'s own Postgres database (see [ADR-0005](ADR/0005-shared-multi-tenant-database.md))
  rather than owning a separate one.
- **Operator** — runs the `flow-engine` process itself (see
  [`user-guides/manual.md`](../user-guides/manual.md)); not a per-request actor.

There is no end-user-facing surface in this repository — the human actor (the person building or
running a flow) interacts entirely through the upstream application.

## Process flow

```mermaid
sequenceDiagram
    actor Tenant as Tenant user (in upstream app)
    participant App as Upstream app (e.g. /flow-builder)
    participant Engine as flow-engine

    Tenant->>App: trigger "run this graph"
    App->>Engine: INSERT flow_jobs (tenant schema; status='pending', type='run', input=...)
    App->>Engine: LISTEN "run:<jobId>"
    Engine-->>App: pg_notify tokens as the graph executes
    App-->>Tenant: relay tokens (e.g. streamed chat response)
    Engine->>Engine: mark job completed/failed/waiting
```

## Scope note

Real (non-fake) LLM providers are not yet implemented — see
[`known-issues/index.md`](../known-issues/index.md) and [`backlog.md`](../backlog.md). This
document describes the capability as currently shipped.
