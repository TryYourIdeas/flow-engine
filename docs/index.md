# flow-engine docs

Map of this project's documentation. See the top-level `web/CLAUDE.md` for cross-project
conventions this doc set follows.

## User guides

- [`user-guides/config.md`](user-guides/config.md) — environment variables.
- [`user-guides/features.md`](user-guides/features.md) — what the engine does.
- [`user-guides/manual.md`](user-guides/manual.md) — running it locally, job lifecycle diagram.

## Project history and status

- [`changes.md`](changes.md) — running changelog, newest first.
- [`backlog.md`](backlog.md) — work deliberately deferred, with value/consequence.
- [`known-issues/index.md`](known-issues/index.md) — live gaps in the shipped system.
- [`learnings/`](learnings/) — bugs/gotchas hit during implementation, for the next engineer.

## Architecture

- [`architecture/business-architecture.md`](architecture/business-architecture.md) — purpose,
  capability, actors, process flow.
- [`architecture/data-architecture.md`](architecture/data-architecture.md) — the `jobs` table,
  access patterns, ephemeral progress data.
- [`architecture/application-architecture.md`](architecture/application-architecture.md) —
  component overview, layers, concurrency model.
- [`architecture/technology-architecture.md`](architecture/technology-architecture.md) — stack,
  runtime, local infrastructure.
- [`architecture/ADR/`](architecture/ADR/) — architectural decisions made in this repo, numbered
  sequentially.
