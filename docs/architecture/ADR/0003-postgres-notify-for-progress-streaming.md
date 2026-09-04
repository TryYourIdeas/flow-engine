# ADR-0003: Stream execution progress via Postgres `pg_notify`, not a direct connection from the worker

## Status

Accepted (2026-08-27)

## Context

As a graph executes, its worker produces a stream of `token`/`done`/`error` messages
(`src/worker/worker-messages.types.ts`) that a consuming app (e.g. `home`'s `/flow-builder`, or
whatever enqueued the job) needs to relay to a client in real time. `flow-engine` has no HTTP
server and no direct connection to whatever process is waiting on a given job's output — it only
shares Postgres with the rest of the workspace.

## Decision

`ProgressPublisherService` (`src/progress/progress-publisher.service.ts`) publishes each
`WorkerMessage` to a Postgres NOTIFY channel named `run:<jobId>`, using the `pg_notify(channel,
payload)` SQL function with bound parameters:

```ts
await this.pool.query('SELECT pg_notify($1, $2)', [channel, payload]);
```

A consuming app subscribes with `LISTEN "run:<jobId>"` on its own Postgres connection to receive
tokens as they're produced, without any direct network path to `flow-engine` itself.

This was refactored (`5bab6ef`) from an earlier approach that built a raw `NOTIFY <channel>,
'<payload>'` string with manual escaping — `pg_notify()` takes the channel and payload as bound
query parameters instead, removing a class of injection/escaping bugs (a payload or channel name
containing quotes/special characters could not previously be handled safely by string
concatenation).

Rejected alternative: exposing an HTTP/WebSocket/SSE endpoint directly from `flow-engine` for
subscribers to connect to. Would require this process to run an HTTP server and manage
per-job subscriber connections itself, when every consumer already has direct Postgres access
and Postgres's own pub/sub (`LISTEN`/`NOTIFY`) fits the fan-out need without new infrastructure.

## Consequences

- `pg_notify` payloads are capped at 8000 bytes by Postgres; a single `WorkerMessage` (one token,
  or a `done`/`error`) is expected to stay well under that, but this is an implicit constraint
  worth remembering if message shapes grow.
- `NOTIFY` delivery is fire-and-forget — a subscriber that isn't `LISTEN`ing at publish time
  misses that message permanently; there is no replay/backlog. Callers needing a full transcript
  after the fact must read job state from `jobs` (`status`/`error`) rather than relying on having
  caught every notify.
- Every subscriber needs its own dedicated Postgres connection able to issue `LISTEN` and stay
  open for the run's duration — this is a connection-count consideration for whatever app
  consumes these channels at scale.
