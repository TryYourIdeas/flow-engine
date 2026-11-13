# Flow Engine Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core of the standalone `flow-engine` NestJS service — job claiming, per-execution
`worker_thread` isolation, a single-LLM-node LangGraph JS interpreter, and Postgres `NOTIFY`
progress publishing — fully testable against a locally seeded Postgres database, independent of
the `agent-builder`→`home` merge landing.

**Architecture:** A `JobClaimService` polls a `public.jobs` table with
`SELECT ... FOR UPDATE SKIP LOCKED` to safely claim work across multiple engine instances. Each
claimed `run` job is handed to a `WorkerRunnerService`, which spawns a dedicated `worker_thread`
that builds a LangGraph JS `StateGraph` from the job's `GraphDefinition` (via `GraphInterpreter`,
supporting one node type — `llm` — for now) and executes it. Token/lifecycle events flow from the
worker back to the host process via `postMessage`, and the host republishes them as Postgres
`NOTIFY` messages on a `run:<job id>` channel via `ProgressPublisherService`.

**Tech Stack:** NestJS 11, TypeScript, `pg` (raw client, for `LISTEN`/`NOTIFY`), `drizzle-orm`
(node-postgres driver, for typed queries/migrations), `@langchain/langgraph`, `@langchain/core`,
Jest, `worker_threads` (Node built-in), Docker Compose (local Postgres for tests).

---

## Prerequisites this plan does NOT cover

- Real LLM provider wiring (Anthropic/OpenAI/etc.) — the interpreter depends on an injected
  `LlmProviderPort`; a real implementation is a follow-up task, not part of this plan. Tests use a
  fake.
- Resuming from a checkpoint (`PostgresSaver`, `interrupt()`/`Command(resume)`), the `inbox_tasks`
  flow, and the `home`-side job producer/SSE relay — separate plans per the brainstorming design
  doc (`docs/superpowers/specs/2026-08-27-execution-engine-architecture-design.md`, Section 3–4).
- Any connection to `home`'s real tenant schema — this plan seeds its own local test schemas
  shaped like the eventual `graphs`/`llm_provider_keys` tables, per that same design doc, so it
  does not block on the `agent-builder`→`home` merge landing.

---

## File Structure

```
web/flow-engine/
  docker-compose.yml                          # local Postgres for dev/test
  drizzle.config.ts                            # points at src/db/schema/public.ts
  src/
    db/
      client.ts                                # drizzle + pg Pool singleton
      schema/
        public.ts                              # jobs table (cross-tenant queue)
        tenant.ts                               # graphs, llm_provider_keys (per-tenant schema shape)
      migrations/                              # drizzle-kit output (public)
      test/
        seed.ts                                 # test helpers: create tenant schema, seed rows
    jobs/
      job-claim.service.ts
      job-claim.service.spec.ts
      job.types.ts
    graph/
      graph-definition.types.ts
      llm-provider.port.ts
      fake-llm-provider.ts                      # test double, lives in src so tests in graph/ and worker/ can share it
      graph-interpreter.ts
      graph-interpreter.spec.ts
    worker/
      graph-execution.worker.ts                 # the worker_thread entry point
      worker-messages.types.ts
      worker-runner.service.ts
      worker-runner.service.spec.ts
    progress/
      progress-publisher.service.ts
      progress-publisher.service.spec.ts
    orchestrator/
      execution-orchestrator.service.ts
      execution-orchestrator.service.spec.ts
    app.module.ts                               # wire all providers (modify existing boilerplate)
    main.ts                                      # unchanged from existing boilerplate
```

---

## Task 1: Local Postgres + Drizzle wiring

**Files:**
- Create: `web/flow-engine/docker-compose.yml`
- Create: `web/flow-engine/.env.example`
- Create: `web/flow-engine/src/db/client.ts`
- Create: `web/flow-engine/src/db/schema/public.ts`
- Create: `web/flow-engine/drizzle.config.ts`
- Modify: `web/flow-engine/package.json`
- Modify: `web/flow-engine/.gitignore`

- [ ] **Step 1: Install dependencies**

```bash
cd web/flow-engine
npm install pg drizzle-orm dotenv
npm install -D drizzle-kit @types/pg
```

- [ ] **Step 2: Add the local Postgres compose file**

```yaml
# web/flow-engine/docker-compose.yml
services:
  postgres:
    image: postgres:18
    environment:
      POSTGRES_USER: flow_engine
      POSTGRES_PASSWORD: flow_engine
      POSTGRES_DB: flow_engine
    ports:
      - '5433:5432'
    volumes:
      - flow_engine_pg_data:/var/lib/postgresql/data

volumes:
  flow_engine_pg_data:
```

- [ ] **Step 3: Add env example and gitignore entry**

```bash
# web/flow-engine/.env.example
DATABASE_URL=postgres://flow_engine:flow_engine@localhost:5433/flow_engine
```

Append to `web/flow-engine/.gitignore`:

```
.env
```

- [ ] **Step 4: Define the `jobs` table (public/cross-tenant schema)**

```typescript
// web/flow-engine/src/db/schema/public.ts
import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type', { enum: ['run', 'resume'] }).notNull(),
  tenantId: text('tenant_id').notNull(),
  userId: text('user_id').notNull(),
  graphId: text('graph_id').notNull(),
  runId: uuid('run_id'),
  input: jsonb('input'),
  status: text('status', {
    enum: ['pending', 'running', 'completed', 'failed'],
  })
    .notNull()
    .default('pending'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

`runId` is null for `type: 'run'` jobs (the job's own `id` *is* the run id once claimed) and set to
the originating run's job id for `type: 'resume'` jobs.

- [ ] **Step 5: Drizzle client singleton**

```typescript
// web/flow-engine/src/db/client.ts
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as publicSchema from './schema/public';

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema: publicSchema });
  return { db, pool };
}
```

- [ ] **Step 6: drizzle-kit config and generate the initial migration**

```typescript
// web/flow-engine/drizzle.config.ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema/public.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

Add to `package.json` `"scripts"`:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate"
```

Run:

```bash
cp .env.example .env
docker compose up -d
npm run db:generate
npm run db:migrate
```

Expected: `src/db/migrations/0000_*.sql` is created and applies cleanly with no errors; connecting
with `psql $DATABASE_URL -c '\dt'` shows a `jobs` table.

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml .env.example .gitignore drizzle.config.ts package.json package-lock.json src/db
git commit -m "feat: add Postgres jobs table and Drizzle wiring"
```

---

## Task 2: Job claiming with `SELECT ... FOR UPDATE SKIP LOCKED`

**Files:**
- Create: `web/flow-engine/src/jobs/job.types.ts`
- Create: `web/flow-engine/src/jobs/job-claim.service.ts`
- Create: `web/flow-engine/src/jobs/job-claim.service.spec.ts`
- Create: `web/flow-engine/src/db/test/seed.ts`

- [ ] **Step 1: Job types**

```typescript
// web/flow-engine/src/jobs/job.types.ts
export interface ClaimedJob {
  id: string;
  type: 'run' | 'resume';
  tenantId: string;
  userId: string;
  graphId: string;
  runId: string | null;
  input: unknown;
}
```

- [ ] **Step 2: Test seeding helper**

```typescript
// web/flow-engine/src/db/test/seed.ts
import { createDb } from '../client';
import { jobs } from '../schema/public';

export function testDb() {
  const connectionString =
    process.env.DATABASE_URL ??
    'postgres://flow_engine:flow_engine@localhost:5433/flow_engine';
  return createDb(connectionString);
}

export async function seedJob(
  db: ReturnType<typeof createDb>['db'],
  overrides: Partial<typeof jobs.$inferInsert> = {},
) {
  const [row] = await db
    .insert(jobs)
    .values({
      type: 'run',
      tenantId: 'tenant-1',
      userId: 'user-1',
      graphId: 'graph-1',
      status: 'pending',
      ...overrides,
    })
    .returning();
  return row;
}

export async function clearJobs(db: ReturnType<typeof createDb>['db']) {
  await db.delete(jobs);
}
```

- [ ] **Step 3: Write the failing test — claims a pending job and marks it running**

```typescript
// web/flow-engine/src/jobs/job-claim.service.spec.ts
import { JobClaimService } from './job-claim.service';
import { testDb, seedJob, clearJobs } from '../db/test/seed';

describe('JobClaimService', () => {
  const { db, pool } = testDb();
  const service = new JobClaimService(db);

  afterEach(async () => {
    await clearJobs(db);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('claims a pending job and marks it running', async () => {
    const seeded = await seedJob(db);

    const claimed = await service.claimNext();

    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(seeded.id);
    expect(claimed!.tenantId).toBe('tenant-1');
    expect(claimed!.graphId).toBe('graph-1');
  });

  it('returns null when there is no pending job', async () => {
    const claimed = await service.claimNext();
    expect(claimed).toBeNull();
  });

  it('never lets two concurrent claims return the same job', async () => {
    await seedJob(db);
    await seedJob(db);

    const [first, second] = await Promise.all([
      service.claimNext(),
      service.claimNext(),
    ]);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.id).not.toBe(second!.id);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

```bash
npm test -- job-claim.service.spec.ts
```

Expected: FAIL — `Cannot find module './job-claim.service'`.

- [ ] **Step 5: Implement `JobClaimService`**

```typescript
// web/flow-engine/src/jobs/job-claim.service.ts
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { createDb } from '../db/client';
import type { ClaimedJob } from './job.types';

@Injectable()
export class JobClaimService {
  constructor(private readonly db: ReturnType<typeof createDb>['db']) {}

  async claimNext(): Promise<ClaimedJob | null> {
    const result = await this.db.execute<{
      id: string;
      type: 'run' | 'resume';
      tenant_id: string;
      user_id: string;
      graph_id: string;
      run_id: string | null;
      input: unknown;
    }>(sql`
      UPDATE jobs
      SET status = 'running', updated_at = now()
      WHERE id = (
        SELECT id FROM jobs
        WHERE status = 'pending'
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, type, tenant_id, user_id, graph_id, run_id, input
    `);

    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      type: row.type,
      tenantId: row.tenant_id,
      userId: row.user_id,
      graphId: row.graph_id,
      runId: row.run_id,
      input: row.input,
    };
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npm test -- job-claim.service.spec.ts
```

Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/jobs src/db/test
git commit -m "feat: add race-safe job claiming via SELECT FOR UPDATE SKIP LOCKED"
```

---

## Task 3: `GraphDefinition` types and the `LlmProviderPort`

**Files:**
- Create: `web/flow-engine/src/graph/graph-definition.types.ts`
- Create: `web/flow-engine/src/graph/llm-provider.port.ts`
- Create: `web/flow-engine/src/graph/fake-llm-provider.ts`

- [ ] **Step 1: Minimal `GraphDefinition` shape (single `llm` node type)**

```typescript
// web/flow-engine/src/graph/graph-definition.types.ts
export interface LlmNodeData {
  systemPrompt: string;
  provider: 'anthropic' | 'openai' | 'google';
  model: string;
  temperature: number;
}

export interface GraphNode {
  id: string;
  type: 'llm';
  data: LlmNodeData;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphDefinition {
  entryNodeId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
```

- [ ] **Step 2: `LlmProviderPort` — the seam that keeps the interpreter testable without real API calls**

```typescript
// web/flow-engine/src/graph/llm-provider.port.ts
export interface LlmCompletionParams {
  systemPrompt: string;
  model: string;
  temperature: number;
  input: string;
}

export interface LlmProviderPort {
  streamCompletion(
    params: LlmCompletionParams,
  ): AsyncIterable<{ token: string }>;
}
```

- [ ] **Step 3: Fake implementation for tests**

```typescript
// web/flow-engine/src/graph/fake-llm-provider.ts
import type { LlmProviderPort, LlmCompletionParams } from './llm-provider.port';

export class FakeLlmProvider implements LlmProviderPort {
  constructor(private readonly tokens: string[] = ['Hello', ', ', 'world', '!']) {}

  async *streamCompletion(
    _params: LlmCompletionParams,
  ): AsyncIterable<{ token: string }> {
    for (const token of this.tokens) {
      yield { token };
    }
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/graph/graph-definition.types.ts src/graph/llm-provider.port.ts src/graph/fake-llm-provider.ts
git commit -m "feat: define GraphDefinition types and LlmProviderPort seam"
```

(No test in this task — these are pure type/interface definitions plus a test double, exercised by
Task 4's tests.)

---

## Task 4: `GraphInterpreter` — build and run a single-LLM-node LangGraph

**Files:**
- Create: `web/flow-engine/src/graph/graph-interpreter.ts`
- Create: `web/flow-engine/src/graph/graph-interpreter.spec.ts`

- [ ] **Step 1: Install LangGraph**

```bash
cd web/flow-engine
npm install @langchain/langgraph @langchain/core
```

- [ ] **Step 2: Write the failing test**

```typescript
// web/flow-engine/src/graph/graph-interpreter.spec.ts
import { GraphInterpreter } from './graph-interpreter';
import { FakeLlmProvider } from './fake-llm-provider';
import type { GraphDefinition } from './graph-definition.types';

describe('GraphInterpreter', () => {
  const definition: GraphDefinition = {
    entryNodeId: 'llm-1',
    nodes: [
      {
        id: 'llm-1',
        type: 'llm',
        data: {
          systemPrompt: 'You are a helpful assistant.',
          provider: 'anthropic',
          model: 'claude-test',
          temperature: 0.7,
        },
      },
    ],
    edges: [],
  };

  it('streams tokens from the single LLM node in order', async () => {
    const provider = new FakeLlmProvider(['Hi', ' there']);
    const interpreter = new GraphInterpreter(provider);

    const events: { nodeId: string; token: string }[] = [];
    for await (const event of interpreter.run(definition, {
      input: 'Hello',
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { nodeId: 'llm-1', token: 'Hi' },
      { nodeId: 'llm-1', token: ' there' },
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- graph-interpreter.spec.ts
```

Expected: FAIL — `Cannot find module './graph-interpreter'`.

- [ ] **Step 4: Implement `GraphInterpreter`**

```typescript
// web/flow-engine/src/graph/graph-interpreter.ts
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import type { GraphDefinition, GraphNode } from './graph-definition.types';
import type { LlmProviderPort } from './llm-provider.port';

const ExecutionState = Annotation.Root({
  input: Annotation<string>,
  output: Annotation<string>({
    reducer: (existing, update) => existing + update,
    default: () => '',
  }),
});

export interface InterpreterInput {
  input: string;
}

export interface InterpreterEvent {
  nodeId: string;
  token: string;
}

export class GraphInterpreter {
  constructor(private readonly llmProvider: LlmProviderPort) {}

  async *run(
    definition: GraphDefinition,
    input: InterpreterInput,
  ): AsyncGenerator<InterpreterEvent> {
    if (definition.nodes.length !== 1 || definition.nodes[0].type !== 'llm') {
      throw new Error(
        'GraphInterpreter currently supports exactly one llm node',
      );
    }

    const node = definition.nodes[0];
    const events: InterpreterEvent[] = [];

    const graph = new StateGraph(ExecutionState)
      .addNode(node.id, async (state) => {
        let output = '';
        for await (const { token } of this.llmProvider.streamCompletion({
          systemPrompt: node.data.systemPrompt,
          model: node.data.model,
          temperature: node.data.temperature,
          input: state.input,
        })) {
          events.push({ nodeId: node.id, token });
          output += token;
        }
        return { output };
      })
      .addEdge(START, node.id)
      .addEdge(node.id, END)
      .compile();

    await graph.invoke({ input: input.input, output: '' });

    for (const event of events) {
      yield event;
    }
  }
}
```

`events` is buffered and yielded after `graph.invoke()` resolves in this first pass — sufficient to
prove the interpreter builds a correct `StateGraph` from `GraphDefinition` and drives the injected
`LlmProviderPort`. True live streaming (yielding as tokens arrive, not after `invoke()` completes)
is Task 5's concern once the worker/host message-passing boundary exists, since that's where
real-time delivery actually matters.

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- graph-interpreter.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/graph/graph-interpreter.ts src/graph/graph-interpreter.spec.ts package.json package-lock.json
git commit -m "feat: add GraphInterpreter for single-LLM-node LangGraph execution"
```

---

## Task 5: `worker_thread` execution boundary

**Files:**
- Create: `web/flow-engine/src/worker/worker-messages.types.ts`
- Create: `web/flow-engine/src/worker/graph-execution.worker.ts`
- Create: `web/flow-engine/src/worker/worker-runner.service.ts`
- Create: `web/flow-engine/src/worker/worker-runner.service.spec.ts`
- Modify: `web/flow-engine/package.json` (test script needs `ts-node` for worker resolution — see Step 5)

- [ ] **Step 1: Message contract between worker and host**

```typescript
// web/flow-engine/src/worker/worker-messages.types.ts
import type { GraphDefinition } from '../graph/graph-definition.types';

export interface WorkerData {
  definition: GraphDefinition;
  input: { input: string };
}

export type WorkerMessage =
  | { kind: 'token'; nodeId: string; token: string }
  | { kind: 'done' }
  | { kind: 'error'; message: string };
```

- [ ] **Step 2: The worker entry point**

```typescript
// web/flow-engine/src/worker/graph-execution.worker.ts
import { parentPort, workerData } from 'node:worker_threads';
import { GraphInterpreter } from '../graph/graph-interpreter';
import { FakeLlmProvider } from '../graph/fake-llm-provider';
import type { WorkerData, WorkerMessage } from './worker-messages.types';

function post(message: WorkerMessage) {
  parentPort!.postMessage(message);
}

async function main() {
  const data = workerData as WorkerData;
  // NOTE: FakeLlmProvider is a placeholder wired here so this task is
  // end-to-end testable without a real provider dependency. Swapping in a
  // real LlmProviderPort implementation (keyed by node.data.provider) is a
  // follow-up task, not part of this plan (see "Prerequisites this plan does
  // NOT cover").
  const interpreter = new GraphInterpreter(new FakeLlmProvider());

  try {
    for await (const event of interpreter.run(data.definition, data.input)) {
      post({ kind: 'token', nodeId: event.nodeId, token: event.token });
    }
    post({ kind: 'done' });
  } catch (err) {
    post({ kind: 'error', message: (err as Error).message });
  }
}

main();
```

- [ ] **Step 3: `WorkerRunnerService` — spawns the worker, exposes an async iterable of messages**

```typescript
// web/flow-engine/src/worker/worker-runner.service.ts
import { Injectable } from '@nestjs/common';
import { Worker } from 'node:worker_threads';
import * as path from 'node:path';
import type { WorkerData, WorkerMessage } from './worker-messages.types';

@Injectable()
export class WorkerRunnerService {
  async *run(data: WorkerData): AsyncGenerator<WorkerMessage> {
    const isTs = __filename.endsWith('.ts');
    const workerPath = path.join(
      __dirname,
      isTs ? 'graph-execution.worker.ts' : 'graph-execution.worker.js',
    );

    const worker = new Worker(workerPath, {
      workerData: data,
      execArgv: isTs ? ['-r', 'ts-node/register'] : [],
    });

    const messages: WorkerMessage[] = [];
    let resolveNext: (() => void) | null = null;
    let finished = false;

    worker.on('message', (message: WorkerMessage) => {
      messages.push(message);
      if (message.kind === 'done' || message.kind === 'error') {
        finished = true;
      }
      resolveNext?.();
    });

    worker.on('error', (err) => {
      messages.push({ kind: 'error', message: err.message });
      finished = true;
      resolveNext?.();
    });

    try {
      while (true) {
        while (messages.length > 0) {
          const message = messages.shift()!;
          yield message;
          if (message.kind === 'done' || message.kind === 'error') {
            return;
          }
        }
        if (finished) return;
        await new Promise<void>((resolve) => {
          resolveNext = resolve;
        });
      }
    } finally {
      await worker.terminate();
    }
  }
}
```

- [ ] **Step 4: Install `ts-node` (dev-mode worker resolution) and write the failing test**

```bash
cd web/flow-engine
npm install -D ts-node
```

```typescript
// web/flow-engine/src/worker/worker-runner.service.spec.ts
import { WorkerRunnerService } from './worker-runner.service';
import type { GraphDefinition } from '../graph/graph-definition.types';

describe('WorkerRunnerService', () => {
  const definition: GraphDefinition = {
    entryNodeId: 'llm-1',
    nodes: [
      {
        id: 'llm-1',
        type: 'llm',
        data: {
          systemPrompt: 'test',
          provider: 'anthropic',
          model: 'claude-test',
          temperature: 0.5,
        },
      },
    ],
    edges: [],
  };

  it('streams token messages then a done message', async () => {
    const service = new WorkerRunnerService();
    const messages: string[] = [];

    for await (const message of service.run({
      definition,
      input: { input: 'hi' },
    })) {
      messages.push(message.kind);
    }

    expect(messages[messages.length - 1]).toBe('done');
    expect(messages.filter((k) => k === 'token').length).toBeGreaterThan(0);
  }, 15000);
});
```

- [ ] **Step 5: Run test to verify it fails, then passes**

```bash
npm test -- worker-runner.service.spec.ts
```

First run is expected to FAIL (`Cannot find module './worker-runner.service'`) before Step 3's file
exists; after Steps 2–3 are in place, run again:

```bash
npm test -- worker-runner.service.spec.ts
```

Expected: PASS. If it fails with a worker resolution error, confirm `ts-node` is installed and that
`worker-runner.service.ts` and `graph-execution.worker.ts` are in the same directory (the path
resolution in Step 3 depends on that).

- [ ] **Step 6: Commit**

```bash
git add src/worker package.json package-lock.json
git commit -m "feat: run graph execution in an isolated worker_thread"
```

---

## Task 6: `ProgressPublisherService` — Postgres `NOTIFY`

**Files:**
- Create: `web/flow-engine/src/progress/progress-publisher.service.ts`
- Create: `web/flow-engine/src/progress/progress-publisher.service.spec.ts`

- [ ] **Step 1: Write the failing test — publishes a message a raw `LISTEN`er receives**

```typescript
// web/flow-engine/src/progress/progress-publisher.service.spec.ts
import { Client } from 'pg';
import { ProgressPublisherService } from './progress-publisher.service';
import { testDb } from '../db/test/seed';

describe('ProgressPublisherService', () => {
  const { pool } = testDb();
  const connectionString =
    process.env.DATABASE_URL ??
    'postgres://flow_engine:flow_engine@localhost:5433/flow_engine';

  afterAll(async () => {
    await pool.end();
  });

  it('publishes an event that a LISTEN client receives on run:<id>', async () => {
    const listener = new Client({ connectionString });
    await listener.connect();
    await listener.query('LISTEN "run:job-123"');

    const received = new Promise<string>((resolve) => {
      listener.on('notification', (msg) => resolve(msg.payload ?? ''));
    });

    const publisher = new ProgressPublisherService(pool);
    await publisher.publish('job-123', {
      kind: 'token',
      nodeId: 'llm-1',
      token: 'Hi',
    });

    const payload = await received;
    expect(JSON.parse(payload)).toEqual({
      kind: 'token',
      nodeId: 'llm-1',
      token: 'Hi',
    });

    await listener.end();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- progress-publisher.service.spec.ts
```

Expected: FAIL — `Cannot find module './progress-publisher.service'`.

- [ ] **Step 3: Implement `ProgressPublisherService`**

```typescript
// web/flow-engine/src/progress/progress-publisher.service.ts
import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { WorkerMessage } from '../worker/worker-messages.types';

@Injectable()
export class ProgressPublisherService {
  constructor(private readonly pool: Pool) {}

  async publish(runId: string, message: WorkerMessage): Promise<void> {
    const channel = `run:${runId}`;
    const payload = JSON.stringify(message).replace(/'/g, "''");
    await this.pool.query(`NOTIFY "${channel}", '${payload}'`);
  }
}
```

`NOTIFY` does not support parameterized queries for the channel/payload, so the payload is
single-quote-escaped explicitly rather than interpolated via a parameterized query — channel names
are engine-controlled (`run:<uuid>`), and payload content is our own serialized `WorkerMessage`, not
raw user input.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- progress-publisher.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/progress
git commit -m "feat: publish execution progress via Postgres NOTIFY"
```

---

## Task 7: `ExecutionOrchestratorService` — wire claim → run → publish → complete

**Files:**
- Create: `web/flow-engine/src/orchestrator/execution-orchestrator.service.ts`
- Create: `web/flow-engine/src/orchestrator/execution-orchestrator.service.spec.ts`
- Modify: `web/flow-engine/src/jobs/job-claim.service.ts`

- [ ] **Step 1: Add a `complete`/`fail` method to `JobClaimService`**

```typescript
// web/flow-engine/src/jobs/job-claim.service.ts
// add below claimNext():

  async complete(jobId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE jobs SET status = 'completed', updated_at = now() WHERE id = ${jobId}
    `);
  }

  async fail(jobId: string, error: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE jobs SET status = 'failed', error = ${error}, updated_at = now() WHERE id = ${jobId}
    `);
  }
```

- [ ] **Step 2: Write the failing test**

```typescript
// web/flow-engine/src/orchestrator/execution-orchestrator.service.spec.ts
import { ExecutionOrchestratorService } from './execution-orchestrator.service';
import { JobClaimService } from '../jobs/job-claim.service';
import { WorkerRunnerService } from '../worker/worker-runner.service';
import { ProgressPublisherService } from '../progress/progress-publisher.service';
import { testDb, seedJob, clearJobs } from '../db/test/seed';
import { jobs } from '../db/schema/public';
import { eq } from 'drizzle-orm';
import { Client } from 'pg';

describe('ExecutionOrchestratorService', () => {
  const { db, pool } = testDb();
  const jobClaimService = new JobClaimService(db);
  const workerRunnerService = new WorkerRunnerService();
  const progressPublisherService = new ProgressPublisherService(pool);
  const orchestrator = new ExecutionOrchestratorService(
    jobClaimService,
    workerRunnerService,
    progressPublisherService,
  );

  afterEach(async () => {
    await clearJobs(db);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('claims a job, publishes token events, and marks it completed', async () => {
    const seeded = await seedJob(db, {
      input: {
        definition: {
          entryNodeId: 'llm-1',
          nodes: [
            {
              id: 'llm-1',
              type: 'llm',
              data: {
                systemPrompt: 'test',
                provider: 'anthropic',
                model: 'claude-test',
                temperature: 0.5,
              },
            },
          ],
          edges: [],
        },
        input: { input: 'hi' },
      },
    });

    const listener = new Client({
      connectionString:
        process.env.DATABASE_URL ??
        'postgres://flow_engine:flow_engine@localhost:5433/flow_engine',
    });
    await listener.connect();
    await listener.query(`LISTEN "run:${seeded.id}"`);
    const receivedTokens: string[] = [];
    listener.on('notification', (msg) => {
      const event = JSON.parse(msg.payload ?? '{}');
      if (event.kind === 'token') receivedTokens.push(event.token);
    });

    const ran = await orchestrator.processNext();
    expect(ran).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(receivedTokens.length).toBeGreaterThan(0);

    const [row] = await db.select().from(jobs).where(eq(jobs.id, seeded.id));
    expect(row.status).toBe('completed');

    await listener.end();
  }, 15000);

  it('returns false when there is no pending job', async () => {
    const ran = await orchestrator.processNext();
    expect(ran).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- execution-orchestrator.service.spec.ts
```

Expected: FAIL — `Cannot find module './execution-orchestrator.service'`.

- [ ] **Step 4: Implement `ExecutionOrchestratorService`**

```typescript
// web/flow-engine/src/orchestrator/execution-orchestrator.service.ts
import { Injectable } from '@nestjs/common';
import { JobClaimService } from '../jobs/job-claim.service';
import { WorkerRunnerService } from '../worker/worker-runner.service';
import { ProgressPublisherService } from '../progress/progress-publisher.service';
import type { GraphDefinition } from '../graph/graph-definition.types';

interface RunJobInput {
  definition: GraphDefinition;
  input: { input: string };
}

@Injectable()
export class ExecutionOrchestratorService {
  constructor(
    private readonly jobClaimService: JobClaimService,
    private readonly workerRunnerService: WorkerRunnerService,
    private readonly progressPublisherService: ProgressPublisherService,
  ) {}

  /** Claims and fully runs one pending job. Returns false if none was pending. */
  async processNext(): Promise<boolean> {
    const job = await this.jobClaimService.claimNext();
    if (!job) return false;

    if (job.type !== 'run') {
      throw new Error(
        `ExecutionOrchestratorService only handles 'run' jobs in this plan; got '${job.type}'`,
      );
    }

    const runInput = job.input as RunJobInput;

    try {
      for await (const message of this.workerRunnerService.run({
        definition: runInput.definition,
        input: runInput.input,
      })) {
        await this.progressPublisherService.publish(job.id, message);
        if (message.kind === 'error') {
          await this.jobClaimService.fail(job.id, message.message);
          return true;
        }
      }
      await this.jobClaimService.complete(job.id);
    } catch (err) {
      const errorMessage = (err as Error).message;
      await this.progressPublisherService.publish(job.id, {
        kind: 'error',
        message: errorMessage,
      });
      await this.jobClaimService.fail(job.id, errorMessage);
    }

    return true;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- execution-orchestrator.service.spec.ts
```

Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/orchestrator src/jobs/job-claim.service.ts
git commit -m "feat: wire claim, worker execution, and NOTIFY publishing into ExecutionOrchestratorService"
```

---

## Task 8: NestJS module wiring and a manual smoke test

**Files:**
- Modify: `web/flow-engine/src/app.module.ts`
- Delete: `web/flow-engine/src/app.controller.ts`
- Delete: `web/flow-engine/src/app.controller.spec.ts`
- Delete: `web/flow-engine/src/app.service.ts`
- Modify: `web/flow-engine/src/main.ts`

- [ ] **Step 1: Remove the unused boilerplate controller/service**

```bash
cd web/flow-engine
rm src/app.controller.ts src/app.controller.spec.ts src/app.service.ts
```

- [ ] **Step 2: Wire providers in `AppModule`**

```typescript
// web/flow-engine/src/app.module.ts
import { Module, type OnModuleInit } from '@nestjs/common';
import { createDb } from './db/client';
import { JobClaimService } from './jobs/job-claim.service';
import { WorkerRunnerService } from './worker/worker-runner.service';
import { ProgressPublisherService } from './progress/progress-publisher.service';
import { ExecutionOrchestratorService } from './orchestrator/execution-orchestrator.service';

const { db, pool } = createDb(
  process.env.DATABASE_URL ??
    'postgres://flow_engine:flow_engine@localhost:5433/flow_engine',
);

@Module({
  providers: [
    { provide: 'DB', useValue: db },
    { provide: 'PG_POOL', useValue: pool },
    {
      provide: JobClaimService,
      useFactory: () => new JobClaimService(db),
    },
    WorkerRunnerService,
    {
      provide: ProgressPublisherService,
      useFactory: () => new ProgressPublisherService(pool),
    },
    ExecutionOrchestratorService,
  ],
})
export class AppModule implements OnModuleInit {
  constructor(private readonly orchestrator: ExecutionOrchestratorService) {}

  onModuleInit() {
    this.pollLoop();
  }

  private async pollLoop() {
    while (true) {
      const ran = await this.orchestrator.processNext();
      await new Promise((resolve) => setTimeout(resolve, ran ? 0 : 1000));
    }
  }
}
```

This polling loop is intentionally simple (fixed 1s idle interval, single in-process loop) — good
enough to prove the pipeline end-to-end. Replacing it with `LISTEN`-driven wakeups and a bounded
concurrency pool (multiple jobs claimed per instance) is flagged as an open question in the design
doc and is follow-up scope, not part of this plan.

- [ ] **Step 3: Simplify `main.ts` — this service has no HTTP API yet**

```typescript
// web/flow-engine/src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  await NestFactory.createApplicationContext(AppModule);
}
bootstrap();
```

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: PASS — all specs from Tasks 2, 4, 5, 6, 7 green.

- [ ] **Step 5: Manual smoke test**

```bash
docker compose up -d
npm run db:migrate
npm run start
```

In a second terminal, seed a job directly and confirm the service picks it up and completes it:

```bash
psql "$DATABASE_URL" -c "
INSERT INTO jobs (type, tenant_id, user_id, graph_id, status, input)
VALUES ('run', 'tenant-1', 'user-1', 'graph-1', 'pending', '{
  \"definition\": {
    \"entryNodeId\": \"llm-1\",
    \"nodes\": [{\"id\": \"llm-1\", \"type\": \"llm\", \"data\": {\"systemPrompt\": \"test\", \"provider\": \"anthropic\", \"model\": \"claude-test\", \"temperature\": 0.5}}],
    \"edges\": []
  },
  \"input\": {\"input\": \"hi\"}
}');
"
sleep 2
psql "$DATABASE_URL" -c "SELECT id, status, error FROM jobs ORDER BY created_at DESC LIMIT 1;"
```

Expected: `status` is `completed`, `error` is null.

- [ ] **Step 6: Commit**

```bash
git add src/app.module.ts src/main.ts
git commit -m "feat: wire flow-engine module and run the job poll loop on startup"
```

---

## Self-Review Notes

- **Spec coverage:** job claiming with race safety (Task 2), single-LLM-node `GraphDefinition`
  interpretation (Tasks 3–4), `worker_thread`-per-execution isolation (Task 5), `NOTIFY`-based
  progress publishing (Task 6), and the full claim→run→publish→complete pipeline (Tasks 7–8) are
  each covered by a task with a real, runnable test. Resume/HITL, real LLM providers, and the
  `home`-side producer/relay are explicitly out of scope per "Prerequisites this plan does NOT
  cover" and belong to follow-up plans once the design doc's remaining open questions (per-tenant
  fairness, engine DB credential boundary, deployment topology) are resolved.
- **Type consistency:** `WorkerMessage` (Task 5) is the single shared type used by
  `graph-execution.worker.ts`, `worker-runner.service.ts`, `progress-publisher.service.ts`, and
  `execution-orchestrator.service.ts` — no renamed duplicates. `GraphDefinition`/`GraphNode` (Task
  3) is the one shape used by `GraphInterpreter`, the worker, and the orchestrator's `RunJobInput`.
- **Known follow-up, not a gap in this plan:** the interpreter buffers all events and yields them
  after `graph.invoke()` resolves (Task 4, Step 4 note) rather than truly streaming as tokens
  arrive from the LLM call. For a single fake-provider node this is invisible in tests; it becomes
  visible once a real streaming LLM provider is wired in (explicitly deferred, see Prerequisites) —
  flag this when that follow-up plan is written.
