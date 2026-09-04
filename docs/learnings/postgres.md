# Learnings — Postgres

## `postgres:18` image requires the data volume mounted at `/var/lib/postgresql`, not `/var/lib/postgresql/data` (2026-08-27)

### Symptom

A `docker-compose.yml` volume mounted at the traditional
`/var/lib/postgresql/data` path breaks against `postgres:18+` images.

### Root cause

The `postgres:18+` images switched to a `pg_ctlcluster`-style directory layout. Mounting a
volume directly at `.../data` no longer matches how the image lays out its data directory. See
[docker-library/postgres#1259](https://github.com/docker-library/postgres/issues/1259).

### Fix

Mount the named volume at `/var/lib/postgresql` (the parent), not `/var/lib/postgresql/data`:

```yaml
volumes:
  - flow_engine_pg_data:/var/lib/postgresql
```

See `docker-compose.yml`.

### Takeaway

When bumping the Postgres image version in any project's compose file, re-check the volume
mount path against that major version's expected layout — don't assume the traditional
`.../data` mount still applies past Postgres 18.

## Unhandled `error` events on an idle `pg.Pool` crash the process (2026-08-27)

### Symptom

The engine process crashed unexpectedly under conditions like a Postgres server restart,
network blip, or admin-initiated connection termination — with no application-level error
surfaced beforehand.

### Root cause

`node-postgres` emits an `error` event directly on the `Pool` (not a query promise rejection)
when an **idle** pooled client loses its connection. An `EventEmitter` with no `'error'`
listener re-throws synchronously, which is an unhandled exception and crashes the Node process —
this happens independently of any in-flight query.

### Fix

`src/db/client.ts` registers `pool.on('error', (err) => logger.error(...))`. The pool recovers
on its own by opening a new connection the next time it's used; logging and continuing is
sufficient, no reconnect logic is needed.

### Takeaway

Any code that creates a `pg.Pool` (or reuses one) must attach an `error` listener at
construction time, even if every query already has its own try/catch — the idle-client error
path bypasses query-level error handling entirely.
