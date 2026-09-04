# ADR-0002: Use a Postgres `jobs` table with `SELECT ... FOR UPDATE SKIP LOCKED` as the job queue

## Status

Accepted (2026-08-27)

## Context

`flow-engine` needs a queue of pending graph-execution jobs that multiple engine instances can
safely poll and claim from concurrently, without two instances ever picking up the same job. The
project already depends on Postgres (via Drizzle) for other state, and no other queueing
infrastructure (Redis/BullMQ, SQS, RabbitMQ, etc.) is present anywhere in this workspace's
`flow-engine`/`agent-builder` design.

## Decision

Model jobs as plain rows in a Postgres `jobs` table (`src/db/schema/public.ts`: `id`, `type`,
`tenantId`, `userId`, `graphId`, `runId`, `input` jsonb, `status`, `error`, timestamps), and claim
the next one with a single atomic statement in `JobClaimService.claimNext()`
(`src/jobs/job-claim.service.ts`):

```sql
UPDATE jobs
SET status = 'running', updated_at = now()
WHERE id = (
  SELECT id FROM jobs
  WHERE status = 'pending'
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING ...
```

`FOR UPDATE SKIP LOCKED` makes concurrent claims from multiple engine instances race-safe: a row
already locked by another transaction's claim is simply skipped rather than blocked on, so two
instances never claim the same job and neither has to wait on the other's transaction.
`AppModule`'s poll loop calls this on a tight cycle (no delay when a job was found, 1s backoff
when the queue was empty).

Rejected alternative: a dedicated queue system (Redis/BullMQ, SQS). Would add new
infrastructure and an operational dependency this workspace doesn't otherwise have, for
capabilities (retries, delayed jobs, dead-letter queues) not yet needed. Revisit if job volume or
required queue semantics outgrow what a polled Postgres table can support.

## Consequences

- No push/wake-up mechanism — claim latency is bounded by the poll loop's up-to-1s backoff, not
  instant. Acceptable at current volume; would need a `LISTEN`/`NOTIFY`-driven wake-up (the
  progress channel already uses `pg_notify`, see
  `0003-postgres-notify-for-progress-streaming.md`) or a real queue if lower latency is required.
- No retry/backoff policy exists for `failed` jobs — a failure is terminal (`jobs.status =
  'failed'`, `jobs.error` set) with no automatic re-queue.
- No lease expiry: a job claimed (`status = 'running'`) by an instance that then dies stays
  `running` forever — this is the "orphaned `running`-status job recovery" gap tracked in
  `docs/known-issues/index.md` and `docs/backlog.md`.
- Scaling job throughput scales with `jobs` table write load on the shared Postgres instance;
  revisit if that becomes a bottleneck.
