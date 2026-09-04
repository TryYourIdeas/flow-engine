# Form Node Engine Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize `flow-engine`'s `GraphInterpreter` from "exactly one `llm` node" to walking an
arbitrary multi-node graph, and add a `form` node type that pauses execution via LangGraph's
`interrupt()`, checkpoints via `PostgresSaver`, and resumes via a `Command({ resume })` carrying
submitted field values — the engine-side half of
`home/docs/superpowers/specs/2026-09-04-flow-builder-form-node-design.md`.

**Architecture:** `GraphInterpreter` builds a dynamic LangGraph JS `StateGraph` from a
`GraphDefinition`'s `nodes`/`edges`/`stateSchema` at run time (one state channel per declared
field, plus the existing fixed `input`/`output` channels), dispatching each node to an `llm` or
`form` handler. A `form` node's handler calls `interrupt()`, which LangGraph checkpoints via an
injected `BaseCheckpointSaver` and surfaces back to the caller as `isInterrupted(result)`. The
worker/orchestrator layer treats this as a new terminal outcome (`waiting_for_input`) that inserts
a durable inbox task (via a new `InboxTaskPort`, following the same port/fake-adapter pattern
already used for `LlmProviderPort`) instead of completing the job, and a `resume` job later loads
the same checkpoint by `runId` (the LangGraph `thread_id`) and continues.

**Tech Stack:** NestJS 11, TypeScript, `@langchain/langgraph` (already a dependency),
`@langchain/langgraph-checkpoint-postgres` (new dependency), Jest, the project's existing
docker-compose local Postgres for integration-style specs.

---

## Prerequisites this plan does NOT cover

- A real `LlmProviderPort` implementation — still `FakeLlmProvider`, unrelated to this plan (see
  `docs/known-issues/index.md`).
- A real, tenant-Postgres-backed `InboxTaskPort` implementation — this plan adds the port and a
  `FakeInboxTaskWriter` test double (mirroring `LlmProviderPort`/`FakeLlmProvider`); the real
  implementation depends on `home`'s `inbox_tasks` table existing (see the `home`-side plan) and on
  the engine's tenant-DB credential/grant model, which is an open question in
  `agent-builder/docs/superpowers/specs/2026-08-27-execution-engine-architecture-design.md` Section
  4 not resolved here.
- The `home`-side run producer, `/inbox` page, and `inbox_tasks` table/API — separate plan.
- Execution timeout, worker pooling, orphaned-job recovery, per-tenant fairness — pre-existing,
  unrelated known gaps (`docs/known-issues/index.md`, `docs/backlog.md`).

---

## File Structure

```
flow-engine/
  src/
    graph/
      graph-definition.types.ts        # MODIFY: add stateSchema, form node type, FormField
      graph-interpreter.ts             # MODIFY: multi-node walk, dynamic state, form/interrupt handling
      graph-interpreter.spec.ts        # MODIFY: update for new run() signature, add form/multi-node tests
      inbox-task.port.ts               # NEW: InboxTaskPort interface
      fake-inbox-task-writer.ts        # NEW: test double, records tasks in memory
    worker/
      worker-messages.types.ts         # MODIFY: WorkerData discriminated union, waiting_for_input message
      graph-execution.worker.ts        # MODIFY: wire PostgresSaver, detect interrupt, post waiting_for_input
      worker-runner.service.ts         # MODIFY: treat waiting_for_input as terminal
      worker-runner.service.spec.ts    # MODIFY: update calls for new WorkerData shape, add pause test
    jobs/
      job-claim.service.ts             # MODIFY: add markWaiting()
      job-claim.service.spec.ts        # MODIFY: add markWaiting test
      job.types.ts                     # MODIFY: widen ClaimedJob.type usage sites (no shape change)
    orchestrator/
      execution-orchestrator.service.ts       # MODIFY: handle resume jobs + waiting_for_input
      execution-orchestrator.service.spec.ts  # MODIFY: update + add resume/pause tests
  docs/
    architecture/
      ADR/0004-langgraph-interrupt-resume-for-form-hitl-nodes.md   # NEW
      application-architecture.md      # MODIFY: diagram + layer notes
    backlog.md                         # MODIFY: add real InboxTaskPort entry
    known-issues/index.md              # MODIFY: add "no real InboxTaskPort" entry
    changes.md                         # MODIFY: add entry
  package.json                         # MODIFY: add @langchain/langgraph-checkpoint-postgres
```

---

### Task 1: Extend `GraphDefinition` types for `stateSchema` and the `form` node

**Files:**
- Modify: `src/graph/graph-definition.types.ts`

- [ ] **Step 1: Add the new types**

Replace the file's contents with:

```ts
export interface LlmNodeData {
  systemPrompt: string;
  provider: 'anthropic' | 'openai' | 'google';
  model: string;
  temperature: number;
}

export interface FormField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'messages';
  required: boolean;
  helpText?: string;
}

export interface FormNodeData {
  label: string;
  prompt: string;
  assigneeMode: 'launcher' | 'specific_user';
  assigneeUserId?: string;
  fields: FormField[];
}

export type GraphNode =
  | { id: string; type: 'llm'; data: LlmNodeData }
  | { id: string; type: 'form'; data: FormNodeData };

export interface GraphEdge {
  source: string;
  target: string;
}

export interface StateField {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'messages';
}

export interface GraphDefinition {
  entryNodeId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stateSchema: { fields: StateField[] };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: fails, listing every existing call site that constructs a `GraphDefinition` without
`stateSchema` (`graph-interpreter.spec.ts`, `execution-orchestrator.service.spec.ts`,
`worker-runner.service.spec.ts`). This is expected — those are fixed in Task 2.

- [ ] **Step 3: Commit**

```bash
git add src/graph/graph-definition.types.ts
git commit -m "feat: add stateSchema and form node type to GraphDefinition"
```

---

### Task 2: Generalize `GraphInterpreter` to walk a multi-node graph

Still `llm`-only at this point — the `form` handler and interrupt handling come in Task 3. This
task's job is purely: stop hardcoding "exactly one node," build the state annotation dynamically,
and dispatch by node type via edges instead of assuming a single node.

**Files:**
- Modify: `src/graph/graph-interpreter.ts`
- Modify: `src/graph/graph-interpreter.spec.ts`

- [ ] **Step 1: Write the failing tests**

Replace `graph-interpreter.spec.ts` with:

```ts
import { MemorySaver } from '@langchain/langgraph';
import { GraphInterpreter } from './graph-interpreter';
import { FakeLlmProvider } from './fake-llm-provider';
import type { GraphDefinition } from './graph-definition.types';
import type {
  LlmProviderPort,
  LlmCompletionParams,
} from './llm-provider.port';

class ThrowingLlmProvider implements LlmProviderPort {
  async *streamCompletion(
    _params: LlmCompletionParams,
  ): AsyncIterable<{ token: string }> {
    yield { token: 'partial' };
    throw new Error('provider failed');
  }
}

describe('GraphInterpreter', () => {
  const singleLlmDefinition: GraphDefinition = {
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
    stateSchema: { fields: [] },
  };

  it('streams tokens from a single LLM node in order', async () => {
    const provider = new FakeLlmProvider(['Hi', ' there']);
    const interpreter = new GraphInterpreter(provider, new MemorySaver());

    const events: unknown[] = [];
    for await (const event of interpreter.run(singleLlmDefinition, 'run-1', {
      kind: 'start',
      input: 'Hello',
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { kind: 'token', nodeId: 'llm-1', token: 'Hi' },
      { kind: 'token', nodeId: 'llm-1', token: ' there' },
    ]);
  });

  it('walks two chained LLM nodes in edge order', async () => {
    const provider = new FakeLlmProvider(['step']);
    const interpreter = new GraphInterpreter(provider, new MemorySaver());
    const definition: GraphDefinition = {
      entryNodeId: 'llm-1',
      nodes: [
        {
          id: 'llm-1',
          type: 'llm',
          data: {
            systemPrompt: 'first',
            provider: 'anthropic',
            model: 'claude-test',
            temperature: 0.5,
          },
        },
        {
          id: 'llm-2',
          type: 'llm',
          data: {
            systemPrompt: 'second',
            provider: 'anthropic',
            model: 'claude-test',
            temperature: 0.5,
          },
        },
      ],
      edges: [{ source: 'llm-1', target: 'llm-2' }],
      stateSchema: { fields: [] },
    };

    const events: unknown[] = [];
    for await (const event of interpreter.run(definition, 'run-2', {
      kind: 'start',
      input: 'Hello',
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { kind: 'token', nodeId: 'llm-1', token: 'step' },
      { kind: 'token', nodeId: 'llm-2', token: 'step' },
    ]);
  });

  it('propagates an error thrown mid-stream by the LLM provider', async () => {
    const provider = new ThrowingLlmProvider();
    const interpreter = new GraphInterpreter(provider, new MemorySaver());

    const collect = async () => {
      const events: unknown[] = [];
      for await (const event of interpreter.run(singleLlmDefinition, 'run-3', {
        kind: 'start',
        input: 'Hello',
      })) {
        events.push(event);
      }
      return events;
    };

    await expect(collect()).rejects.toThrow('provider failed');
  });

  it('rejects a definition whose entryNodeId is not a real node', async () => {
    const provider = new FakeLlmProvider();
    const interpreter = new GraphInterpreter(provider, new MemorySaver());
    const definition: GraphDefinition = {
      entryNodeId: 'missing',
      nodes: [],
      edges: [],
      stateSchema: { fields: [] },
    };

    const collect = async () => {
      const events: unknown[] = [];
      for await (const event of interpreter.run(definition, 'run-4', {
        kind: 'start',
        input: 'hi',
      })) {
        events.push(event);
      }
      return events;
    };

    await expect(collect()).rejects.toThrow("Unknown entryNodeId 'missing'");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest graph-interpreter -t "walks two chained" --verbose`
Expected: FAIL — `run()` doesn't accept a 3-argument call yet, and `GraphInterpreter`'s constructor
doesn't accept a checkpointer.

- [ ] **Step 3: Rewrite the interpreter**

Replace `graph-interpreter.ts` with:

```ts
import {
  StateGraph,
  Annotation,
  START,
  END,
  type BaseCheckpointSaver,
} from '@langchain/langgraph';
import type { GraphDefinition, GraphNode, StateField } from './graph-definition.types';
import type { LlmProviderPort } from './llm-provider.port';

export interface InterpreterEvent {
  kind: 'token';
  nodeId: string;
  token: string;
}

export interface InterpreterStartInput {
  kind: 'start';
  input: string;
}

export interface InterpreterResumeInput {
  kind: 'resume';
  resumeValues: Record<string, unknown>;
}

export type InterpreterInput = InterpreterStartInput | InterpreterResumeInput;

// The graph's shape (which nodes/channels exist) is determined entirely by
// runtime JSON (GraphDefinition), not known at compile time, so the
// StateGraph builder chain below is intentionally untyped (`any`) rather
// than fought into LangGraph JS's generic fluent-builder types.
function buildStateAnnotation(fields: StateField[]) {
  const spec: Record<string, unknown> = {
    input: Annotation<string>(),
    output: Annotation<string>({
      reducer: (existing: string, update: string) => existing + update,
      default: () => '',
    }),
  };
  for (const field of fields) {
    spec[field.key] = Annotation<unknown>();
  }
  return Annotation.Root(spec as never);
}

function buildNodeHandler(
  node: GraphNode,
  llmProvider: LlmProviderPort,
  events: InterpreterEvent[],
) {
  if (node.type === 'llm') {
    return async (state: Record<string, unknown>) => {
      let output = '';
      for await (const { token } of llmProvider.streamCompletion({
        systemPrompt: node.data.systemPrompt,
        model: node.data.model,
        temperature: node.data.temperature,
        input: state.input as string,
      })) {
        events.push({ kind: 'token', nodeId: node.id, token });
        output += token;
      }
      return { output };
    };
  }

  throw new Error(`Unsupported node type '${(node as GraphNode).type}'`);
}

export class GraphInterpreter {
  constructor(
    private readonly llmProvider: LlmProviderPort,
    private readonly checkpointer: BaseCheckpointSaver,
  ) {}

  async *run(
    definition: GraphDefinition,
    runId: string,
    input: InterpreterInput,
  ): AsyncGenerator<InterpreterEvent> {
    if (!definition.nodes.some((n) => n.id === definition.entryNodeId)) {
      throw new Error(`Unknown entryNodeId '${definition.entryNodeId}'`);
    }

    const events: InterpreterEvent[] = [];
    const stateAnnotation = buildStateAnnotation(definition.stateSchema.fields);
    let graph: any = new StateGraph(stateAnnotation);

    for (const node of definition.nodes) {
      graph = graph.addNode(
        node.id,
        buildNodeHandler(node, this.llmProvider, events),
      );
    }

    graph = graph.addEdge(START, definition.entryNodeId);
    const hasOutgoing = new Set(definition.edges.map((e) => e.source));
    for (const edge of definition.edges) {
      graph = graph.addEdge(edge.source, edge.target);
    }
    for (const node of definition.nodes) {
      if (!hasOutgoing.has(node.id)) {
        graph = graph.addEdge(node.id, END);
      }
    }

    const compiled = graph.compile({ checkpointer: this.checkpointer });
    const config = { configurable: { thread_id: runId } };
    const invokeInput =
      input.kind === 'start' ? { input: input.input } : input;

    await compiled.invoke(invokeInput, config);

    for (const event of events) {
      yield event;
    }
  }
}
```

Note: `Command` isn't used yet for the `resume` path here — that lands in Task 3 alongside
`interrupt()`, since resume only means something once a `form` node can actually pause. For now
`input.kind === 'resume'` just passes `{ kind, resumeValues }` straight to `invoke`, which no
`llm`-only graph will ever receive in practice; Task 3 replaces this branch properly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest graph-interpreter --verbose`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/graph/graph-interpreter.ts src/graph/graph-interpreter.spec.ts
git commit -m "feat: generalize GraphInterpreter to walk multi-node graphs"
```

---

### Task 3: Add the `form` node handler with interrupt/resume support

**Files:**
- Modify: `src/graph/graph-interpreter.ts`
- Modify: `src/graph/graph-interpreter.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to the bottom of `graph-interpreter.spec.ts` (inside the existing `describe` block, before the
closing `});`):

```ts
  it('pauses on a form node and resumes with submitted field values in state', async () => {
    const provider = new FakeLlmProvider(['after-form']);
    const checkpointer = new MemorySaver();
    const interpreter = new GraphInterpreter(provider, checkpointer);
    const definition: GraphDefinition = {
      entryNodeId: 'form-1',
      nodes: [
        {
          id: 'form-1',
          type: 'form',
          data: {
            label: 'Approval',
            prompt: 'Please review and approve',
            assigneeMode: 'launcher',
            fields: [
              { key: 'approved', label: 'Approved?', type: 'boolean', required: true },
            ],
          },
        },
        {
          id: 'llm-1',
          type: 'llm',
          data: {
            systemPrompt: 'continue',
            provider: 'anthropic',
            model: 'claude-test',
            temperature: 0.5,
          },
        },
      ],
      edges: [{ source: 'form-1', target: 'llm-1' }],
      stateSchema: { fields: [{ key: 'approved', type: 'boolean' }] },
    };

    const startEvents: unknown[] = [];
    for await (const event of interpreter.run(definition, 'run-form-1', {
      kind: 'start',
      input: 'Hello',
    })) {
      startEvents.push(event);
    }

    expect(startEvents).toEqual([
      {
        kind: 'interrupted',
        nodeId: 'form-1',
        prompt: 'Please review and approve',
        fields: [
          { key: 'approved', label: 'Approved?', type: 'boolean', required: true },
        ],
        assigneeMode: 'launcher',
        assigneeUserId: undefined,
      },
    ]);

    const resumeEvents: unknown[] = [];
    for await (const event of interpreter.run(definition, 'run-form-1', {
      kind: 'resume',
      resumeValues: { approved: true },
    })) {
      resumeEvents.push(event);
    }

    expect(resumeEvents).toEqual([
      { kind: 'token', nodeId: 'llm-1', token: 'after-form' },
    ]);

    const tuple = await checkpointer.getTuple({
      configurable: { thread_id: 'run-form-1' },
    });
    expect(tuple?.checkpoint.channel_values.approved).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest graph-interpreter -t "pauses on a form node" --verbose`
Expected: FAIL — `form` node type throws `Unsupported node type 'form'`, and `run()` never yields
an `interrupted` event.

- [ ] **Step 3: Implement interrupt handling**

In `graph-interpreter.ts`:

1. Update the import line to pull in `interrupt`, `Command`, `isInterrupted`, and `INTERRUPT`:

```ts
import {
  StateGraph,
  Annotation,
  START,
  END,
  interrupt,
  Command,
  isInterrupted,
  INTERRUPT,
  type BaseCheckpointSaver,
} from '@langchain/langgraph';
import type {
  GraphDefinition,
  GraphNode,
  StateField,
  FormField,
} from './graph-definition.types';
```

2. Add the interrupt payload and extend `InterpreterEvent` (replace the existing
   `InterpreterEvent` interface with a union):

```ts
export interface FormInterruptPayload {
  nodeId: string;
  prompt: string;
  fields: FormField[];
  assigneeMode: 'launcher' | 'specific_user';
  assigneeUserId?: string;
}

export type InterpreterEvent =
  | { kind: 'token'; nodeId: string; token: string }
  | ({ kind: 'interrupted' } & FormInterruptPayload);
```

3. In `buildNodeHandler`, add the `form` branch before the final `throw`:

```ts
  if (node.type === 'form') {
    return async () => {
      const resumeValues = interrupt<
        FormInterruptPayload,
        Record<string, unknown>
      >({
        nodeId: node.id,
        prompt: node.data.prompt,
        fields: node.data.fields,
        assigneeMode: node.data.assigneeMode,
        assigneeUserId: node.data.assigneeUserId,
      });
      return resumeValues;
    };
  }
```

4. In `buildNodeHandler`'s `llm` branch, the handler signature narrows `events` to only ever push
   `{ kind: 'token', ... }` — that's still valid since `InterpreterEvent`'s first union member is
   unchanged; no edit needed there.

5. In `GraphInterpreter.run()`, replace the `resume` branch of `invokeInput` and the post-invoke
   section:

```ts
    const invokeInput =
      input.kind === 'start'
        ? { input: input.input }
        : new Command({ resume: input.resumeValues });

    const result = await compiled.invoke(invokeInput, config);

    for (const event of events) {
      yield event;
    }

    if (isInterrupted<FormInterruptPayload>(result)) {
      const payload = result[INTERRUPT][0]?.value;
      if (!payload) {
        throw new Error('graph interrupted with no payload');
      }
      yield { kind: 'interrupted', ...payload };
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest graph-interpreter --verbose`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/graph/graph-interpreter.ts src/graph/graph-interpreter.spec.ts
git commit -m "feat: add form node interrupt/resume support to GraphInterpreter"
```

---

### Task 4: `InboxTaskPort` + `FakeInboxTaskWriter`

**Files:**
- Create: `src/graph/inbox-task.port.ts`
- Create: `src/graph/fake-inbox-task-writer.ts`
- Test: `src/graph/fake-inbox-task-writer.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { FakeInboxTaskWriter } from './fake-inbox-task-writer';

describe('FakeInboxTaskWriter', () => {
  it('records created tasks in memory', async () => {
    const writer = new FakeInboxTaskWriter();

    await writer.createTask({
      tenantId: 'tenant-1',
      runId: 'run-1',
      nodeId: 'form-1',
      prompt: 'Approve?',
      fields: [{ key: 'approved', label: 'Approved?', type: 'boolean', required: true }],
      assigneeUserId: 'user-1',
    });

    expect(writer.tasks).toEqual([
      {
        tenantId: 'tenant-1',
        runId: 'run-1',
        nodeId: 'form-1',
        prompt: 'Approve?',
        fields: [{ key: 'approved', label: 'Approved?', type: 'boolean', required: true }],
        assigneeUserId: 'user-1',
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest fake-inbox-task-writer --verbose`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the port and fake**

`src/graph/inbox-task.port.ts`:

```ts
import type { FormField } from './graph-definition.types';

export interface InboxTask {
  tenantId: string;
  runId: string;
  nodeId: string;
  prompt: string;
  fields: FormField[];
  assigneeUserId: string;
}

export interface InboxTaskPort {
  createTask(task: InboxTask): Promise<void>;
}
```

`src/graph/fake-inbox-task-writer.ts`:

```ts
import type { InboxTask, InboxTaskPort } from './inbox-task.port';

export class FakeInboxTaskWriter implements InboxTaskPort {
  readonly tasks: InboxTask[] = [];

  async createTask(task: InboxTask): Promise<void> {
    this.tasks.push(task);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest fake-inbox-task-writer --verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/graph/inbox-task.port.ts src/graph/fake-inbox-task-writer.ts src/graph/fake-inbox-task-writer.spec.ts
git commit -m "feat: add InboxTaskPort and FakeInboxTaskWriter test double"
```

---

### Task 5: `jobs.status` gains `waiting`, and `JobClaimService.markWaiting()`

**Files:**
- Modify: `src/db/schema/public.ts`
- Modify: `src/jobs/job-claim.service.ts`
- Modify: `src/jobs/job-claim.service.spec.ts`
- Modify: `src/db/test/seed.ts`

- [ ] **Step 1: Write the failing test**

Add to `job-claim.service.spec.ts`, inside the `describe` block:

```ts
  it('marks a running job waiting and records its runId', async () => {
    const seeded = await seedJob(db);
    await service.claimNext();

    await service.markWaiting(seeded.id, 'run-123');

    const [row] = await db
      .select()
      .from((await import('../db/schema/public')).jobs)
      .where((await import('drizzle-orm')).eq(
        (await import('../db/schema/public')).jobs.id,
        seeded.id,
      ));
    expect(row.status).toBe('waiting');
    expect(row.runId).toBe('run-123');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest job-claim.service -t "marks a running job waiting" --verbose`
Expected: FAIL — `service.markWaiting` is not a function.

- [ ] **Step 3: Widen the status enum and add `markWaiting`**

In `src/db/schema/public.ts`, change the `status` column definition:

```ts
    status: text('status', {
      enum: ['pending', 'running', 'waiting', 'completed', 'failed'],
    })
      .notNull()
      .default('pending'),
```

In `src/jobs/job.types.ts`, widen `ClaimedJob.type` is unchanged (still `'run' | 'resume'` — job
*type* and job *status* are different fields; only `status` gains `waiting`).

In `src/jobs/job-claim.service.ts`, add a method after `complete`:

```ts
  async markWaiting(jobId: string, runId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE jobs SET status = 'waiting', run_id = ${runId}, updated_at = now() WHERE id = ${jobId}
    `);
  }
```

- [ ] **Step 4: Confirm no migration is needed**

The `status` column is plain `text` with no database-level `CHECK` constraint (confirm in
`src/db/migrations/0000_tan_purifiers.sql` — the column is declared `"status" text ... NOT NULL`
with no constraint) — the `enum` on `text(...)` is TypeScript-level only. Run:

```bash
npm run db:generate
```

Expected: drizzle-kit reports no schema changes (or generates an empty/no-op migration) — confirms
this is a pure type-level change. If it proposes a real DDL change, stop and re-examine before
continuing (would mean the column has more constraints than assumed).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest job-claim.service --verbose`
Expected: PASS, all 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/public.ts src/jobs/job-claim.service.ts src/jobs/job-claim.service.spec.ts
git commit -m "feat: add waiting job status and JobClaimService.markWaiting"
```

---

### Task 6: Worker message contract — `WorkerData` union and `waiting_for_input`

**Files:**
- Modify: `src/worker/worker-messages.types.ts`

- [ ] **Step 1: Rewrite the types**

```ts
import type { GraphDefinition, FormField } from '../graph/graph-definition.types';

export interface RunJobInput {
  definition: GraphDefinition;
  input: { input: string };
}

export interface ResumeJobInput {
  definition: GraphDefinition;
  resumeValues: Record<string, unknown>;
}

export type WorkerData =
  | ({ kind: 'start'; runId: string } & RunJobInput)
  | ({ kind: 'resume'; runId: string } & ResumeJobInput);

export type WorkerMessage =
  | { kind: 'token'; nodeId: string; token: string }
  | {
      kind: 'waiting_for_input';
      nodeId: string;
      prompt: string;
      fields: FormField[];
      assigneeMode: 'launcher' | 'specific_user';
      assigneeUserId?: string;
    }
  | { kind: 'done' }
  | { kind: 'error'; message: string };
```

This is a types-only change with no independent test — its consumers (`WorkerRunnerService`,
`graph-execution.worker.ts`, `ExecutionOrchestratorService`) are updated and tested in the next two
tasks, and a standalone compile of just this file has nothing to assert.

- [ ] **Step 2: Commit**

```bash
git add src/worker/worker-messages.types.ts
git commit -m "feat: add WorkerData discriminated union and waiting_for_input message"
```

---

### Task 7: Wire `PostgresSaver` into the worker and handle interrupts

**Files:**
- Modify: `package.json`
- Modify: `src/worker/graph-execution.worker.ts`
- Modify: `src/worker/worker-runner.service.ts`
- Modify: `src/worker/worker-runner.service.spec.ts`

- [ ] **Step 1: Add the checkpoint-postgres dependency**

```bash
npm install @langchain/langgraph-checkpoint-postgres@^1.0.5
```

- [ ] **Step 2: Write the failing tests**

Replace `worker-runner.service.spec.ts` with:

```ts
import { WorkerRunnerService } from './worker-runner.service';
import type { GraphDefinition } from '../graph/graph-definition.types';

describe('WorkerRunnerService', () => {
  const llmOnlyDefinition: GraphDefinition = {
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
    stateSchema: { fields: [] },
  };

  it('streams token messages then a done message', async () => {
    const service = new WorkerRunnerService();
    const messages: string[] = [];

    for await (const message of service.run({
      kind: 'start',
      runId: 'wr-run-1',
      definition: llmOnlyDefinition,
      input: { input: 'hi' },
    })) {
      messages.push(message.kind);
    }

    expect(messages[messages.length - 1]).toBe('done');
    expect(messages.filter((k) => k === 'token').length).toBeGreaterThan(0);
  }, 15000);

  it('surfaces an error message when the definition is unsupported', async () => {
    const invalidDefinition: GraphDefinition = {
      entryNodeId: 'missing',
      nodes: [],
      edges: [],
      stateSchema: { fields: [] },
    };

    const service = new WorkerRunnerService();
    const messages: Array<{ kind: string; message?: string }> = [];

    for await (const message of service.run({
      kind: 'start',
      runId: 'wr-run-2',
      definition: invalidDefinition,
      input: { input: 'hi' },
    })) {
      messages.push(message);
    }

    const lastMessage = messages[messages.length - 1];
    expect(lastMessage.kind).toBe('error');
    expect(lastMessage.message).toContain("Unknown entryNodeId 'missing'");
    expect(messages.some((m) => m.kind === 'done')).toBe(false);
  }, 15000);

  it('posts waiting_for_input and stops when the graph hits a form node', async () => {
    const definition: GraphDefinition = {
      entryNodeId: 'form-1',
      nodes: [
        {
          id: 'form-1',
          type: 'form',
          data: {
            label: 'Approval',
            prompt: 'Approve?',
            assigneeMode: 'launcher',
            fields: [{ key: 'approved', label: 'Approved?', type: 'boolean', required: true }],
          },
        },
      ],
      edges: [],
      stateSchema: { fields: [{ key: 'approved', type: 'boolean' }] },
    };

    const service = new WorkerRunnerService();
    const messages: Array<{ kind: string }> = [];

    for await (const message of service.run({
      kind: 'start',
      runId: `wr-run-3-${Date.now()}`,
      definition,
      input: { input: 'hi' },
    })) {
      messages.push(message);
    }

    expect(messages[messages.length - 1].kind).toBe('waiting_for_input');
    expect(messages.some((m) => m.kind === 'done')).toBe(false);
  }, 15000);
});
```

- [ ] **Step 3: Run tests to verify the new one fails**

Run: `npx jest worker-runner.service --verbose`
Expected: first two tests still pass structurally once `graph-execution.worker.ts` is updated (see
next step — until then all three FAIL because the worker still uses the old `WorkerData` shape and
`FakeLlmProvider`-only `GraphInterpreter` constructor signature).

- [ ] **Step 4: Rewrite the worker entry point**

Replace `graph-execution.worker.ts`:

```ts
import { parentPort, workerData } from 'node:worker_threads';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { GraphInterpreter } from '../graph/graph-interpreter';
import { FakeLlmProvider } from '../graph/fake-llm-provider';
import type { WorkerData, WorkerMessage } from './worker-messages.types';

function post(message: WorkerMessage) {
  parentPort!.postMessage(message);
}

async function main() {
  const data = workerData as WorkerData;
  const connectionString =
    process.env.DATABASE_URL ??
    'postgres://flow_engine:flow_engine@localhost:5433/flow_engine';
  const checkpointer = PostgresSaver.fromConnString(connectionString);
  await checkpointer.setup();

  // NOTE: FakeLlmProvider is a placeholder wired here so this task is
  // end-to-end testable without a real provider dependency. Swapping in a
  // real LlmProviderPort implementation (keyed by node.data.provider) is a
  // follow-up task, not part of this plan.
  const interpreter = new GraphInterpreter(new FakeLlmProvider(), checkpointer);

  try {
    let waiting: Extract<WorkerMessage, { kind: 'waiting_for_input' }> | null =
      null;

    const input =
      data.kind === 'start'
        ? ({ kind: 'start', input: data.input.input } as const)
        : ({ kind: 'resume', resumeValues: data.resumeValues } as const);

    for await (const event of interpreter.run(data.definition, data.runId, input)) {
      if (event.kind === 'token') {
        post({ kind: 'token', nodeId: event.nodeId, token: event.token });
      } else {
        waiting = {
          kind: 'waiting_for_input',
          nodeId: event.nodeId,
          prompt: event.prompt,
          fields: event.fields,
          assigneeMode: event.assigneeMode,
          assigneeUserId: event.assigneeUserId,
        };
      }
    }

    post(waiting ?? { kind: 'done' });
  } catch (err) {
    post({
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

void main();
```

- [ ] **Step 5: Treat `waiting_for_input` as a terminal message in `WorkerRunnerService`**

In `worker-runner.service.ts`, update both terminal-message checks (in `worker.on('message', ...)`
and in the `while (messages.length > 0)` loop) from:

```ts
    if (message.kind === 'done' || message.kind === 'error') {
```

to:

```ts
    if (
      message.kind === 'done' ||
      message.kind === 'error' ||
      message.kind === 'waiting_for_input'
    ) {
```

(two occurrences — the `worker.on('message', ...)` handler and the `while` loop's yield check).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest worker-runner.service --verbose`
Expected: PASS, all 3 tests. Requires the local docker-compose Postgres running (`docker compose up
-d` from the project root, per the existing test setup — `PostgresSaver.setup()` needs a real
connection).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/worker/graph-execution.worker.ts src/worker/worker-runner.service.ts src/worker/worker-runner.service.spec.ts
git commit -m "feat: wire PostgresSaver into the worker and post waiting_for_input on interrupt"
```

---

### Task 8: Orchestrator — handle `resume` jobs and `waiting_for_input`

**Files:**
- Modify: `src/orchestrator/execution-orchestrator.service.ts`
- Modify: `src/orchestrator/execution-orchestrator.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Replace the test that currently asserts `processNext()` throws on a non-`run` job, and add two new
tests. In `execution-orchestrator.service.spec.ts`:

1. Delete the `it('throws when the claimed job is not a run job', ...)` test entirely (that
   restriction is being removed).

2. Update the constructor call to pass a `FakeInboxTaskWriter`:

```ts
import { FakeInboxTaskWriter } from '../graph/fake-inbox-task-writer';
```

```ts
  const inboxTaskWriter = new FakeInboxTaskWriter();
  const orchestrator = new ExecutionOrchestratorService(
    jobClaimService,
    workerRunnerService,
    progressPublisherService,
    inboxTaskWriter,
  );
```

3. Update every existing `seedJob` call whose `input` used the old `{ definition, input }` shape to
   also carry `stateSchema: { fields: [] }` inside `definition`, e.g. the first test's seed becomes:

```ts
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
          stateSchema: { fields: [] },
        },
        input: { input: 'hi' },
      },
    });
```

4. Update the "fails the job" test's definition (empty `nodes`) to also set
   `stateSchema: { fields: [] }`, and change the expected error substring from
   `'GraphInterpreter currently supports exactly one llm node'` to `"Unknown entryNodeId 'llm-1'"`.

5. Add two new tests at the end of the `describe` block:

```ts
  it('writes an inbox task and marks the job waiting when a form node interrupts', async () => {
    const seeded = await seedJob(db, {
      userId: 'launcher-1',
      tenantId: 'tenant-9',
      input: {
        definition: {
          entryNodeId: 'form-1',
          nodes: [
            {
              id: 'form-1',
              type: 'form',
              data: {
                label: 'Approval',
                prompt: 'Approve?',
                assigneeMode: 'launcher',
                fields: [
                  { key: 'approved', label: 'Approved?', type: 'boolean', required: true },
                ],
              },
            },
          ],
          edges: [],
          stateSchema: { fields: [{ key: 'approved', type: 'boolean' }] },
        },
        input: { input: 'hi' },
      },
    });

    const ran = await orchestrator.processNext();
    expect(ran).toBe(true);

    expect(inboxTaskWriter.tasks).toHaveLength(1);
    expect(inboxTaskWriter.tasks[0]).toMatchObject({
      tenantId: 'tenant-9',
      nodeId: 'form-1',
      prompt: 'Approve?',
      assigneeUserId: 'launcher-1',
    });

    const [row] = await db.select().from(jobs).where(eq(jobs.id, seeded.id));
    expect(row.status).toBe('waiting');
    expect(row.runId).toBe(inboxTaskWriter.tasks[0].runId);
  }, 15000);

  it('processes a resume job by loading the checkpoint and continuing', async () => {
    const definition = {
      entryNodeId: 'form-1',
      nodes: [
        {
          id: 'form-1',
          type: 'form',
          data: {
            label: 'Approval',
            prompt: 'Approve?',
            assigneeMode: 'launcher',
            fields: [
              { key: 'approved', label: 'Approved?', type: 'boolean', required: true },
            ],
          },
        },
        {
          id: 'llm-1',
          type: 'llm',
          data: {
            systemPrompt: 'continue',
            provider: 'anthropic',
            model: 'claude-test',
            temperature: 0.5,
          },
        },
      ],
      edges: [{ source: 'form-1', target: 'llm-1' }],
      stateSchema: { fields: [{ key: 'approved', type: 'boolean' }] },
    };

    const started = await seedJob(db, {
      input: { definition, input: { input: 'hi' } },
    });
    await orchestrator.processNext();
    const runId = inboxTaskWriter.tasks[0].runId;

    const resumed = await seedJob(db, {
      type: 'resume',
      runId,
      input: { definition, resumeValues: { approved: true } },
    });

    const ran = await orchestrator.processNext();
    expect(ran).toBe(true);

    const [row] = await db.select().from(jobs).where(eq(jobs.id, resumed.id));
    expect(row.status).toBe('completed');
  }, 15000);
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx jest execution-orchestrator.service --verbose`
Expected: FAIL — `ExecutionOrchestratorService`'s constructor doesn't accept a 4th argument, and it
still throws on non-`run` jobs.

- [ ] **Step 3: Rewrite the orchestrator**

Replace `execution-orchestrator.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { JobClaimService } from '../jobs/job-claim.service';
import { WorkerRunnerService } from '../worker/worker-runner.service';
import { ProgressPublisherService } from '../progress/progress-publisher.service';
import type { InboxTaskPort } from '../graph/inbox-task.port';
import type { ClaimedJob } from '../jobs/job.types';
import type {
  RunJobInput,
  ResumeJobInput,
  WorkerData,
  WorkerMessage,
} from '../worker/worker-messages.types';

@Injectable()
export class ExecutionOrchestratorService {
  constructor(
    private readonly jobClaimService: JobClaimService,
    private readonly workerRunnerService: WorkerRunnerService,
    private readonly progressPublisherService: ProgressPublisherService,
    private readonly inboxTaskWriter: InboxTaskPort,
  ) {}

  /** Claims and fully runs one pending job. Returns false if none was pending. */
  async processNext(): Promise<boolean> {
    const job = await this.jobClaimService.claimNext();
    if (!job) return false;

    const runId = job.runId ?? job.id;
    const workerInput = this.buildWorkerInput(job, runId);

    let alreadyResolved = false;

    try {
      for await (const message of this.workerRunnerService.run(workerInput)) {
        await this.progressPublisherService.publish(job.id, message);

        if (message.kind === 'error') {
          alreadyResolved = true;
          await this.jobClaimService.fail(job.id, message.message);
          return true;
        }

        if (message.kind === 'waiting_for_input') {
          alreadyResolved = true;
          await this.inboxTaskWriter.createTask({
            tenantId: job.tenantId,
            runId,
            nodeId: message.nodeId,
            prompt: message.prompt,
            fields: message.fields,
            assigneeUserId: this.resolveAssignee(message, job),
          });
          await this.jobClaimService.markWaiting(job.id, runId);
          return true;
        }
      }
      await this.jobClaimService.complete(job.id);
    } catch (err) {
      if (alreadyResolved) {
        // The job already reached a terminal outcome above; jobClaimService
        // itself is what threw here. Don't publish a second NOTIFY or
        // overwrite that outcome with this unrelated write error - surface
        // it by letting the promise reject.
        throw err;
      }

      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.progressPublisherService.publish(job.id, {
        kind: 'error',
        message: errorMessage,
      });
      await this.jobClaimService.fail(job.id, errorMessage);
    }

    return true;
  }

  private resolveAssignee(
    message: Extract<WorkerMessage, { kind: 'waiting_for_input' }>,
    job: ClaimedJob,
  ): string {
    if (message.assigneeMode === 'specific_user') {
      if (!message.assigneeUserId) {
        throw new Error(
          `form node '${message.nodeId}' is assigneeMode 'specific_user' but has no assigneeUserId`,
        );
      }
      return message.assigneeUserId;
    }
    return job.userId;
  }

  private buildWorkerInput(job: ClaimedJob, runId: string): WorkerData {
    if (job.type === 'run') {
      const { definition, input } = job.input as RunJobInput;
      return { kind: 'start', runId, definition, input };
    }
    const { definition, resumeValues } = job.input as ResumeJobInput;
    return { kind: 'resume', runId, definition, resumeValues };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest execution-orchestrator.service --verbose`
Expected: PASS, all tests (the original 4 minus the deleted one, plus the 2 new ones = 5 total).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, all specs across the project.

- [ ] **Step 6: Commit**

```bash
git add src/orchestrator/execution-orchestrator.service.ts src/orchestrator/execution-orchestrator.service.spec.ts
git commit -m "feat: handle resume jobs and form-node interrupts in the orchestrator"
```

---

### Task 9: Documentation

**Files:**
- Create: `docs/architecture/ADR/0004-langgraph-interrupt-resume-for-form-hitl-nodes.md`
- Modify: `docs/architecture/application-architecture.md`
- Modify: `docs/backlog.md`
- Modify: `docs/known-issues/index.md`
- Modify: `docs/changes.md`

- [ ] **Step 1: Write the ADR**

Create `docs/architecture/ADR/0004-langgraph-interrupt-resume-for-form-hitl-nodes.md`:

```markdown
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
```

- [ ] **Step 2: Update the application architecture diagram**

In `docs/architecture/application-architecture.md`, update the `WorkerThread` subgraph in the
mermaid diagram to add the checkpointer and the form path, and add a bullet under "Layers" for the
new files. Add this note under "Concurrency model" (or as a new subsection):

```markdown
## Human-in-the-loop pause/resume

A `form` node's handler calls LangGraph's `interrupt()`, checkpointed via `PostgresSaver` (thread
id = the run's `runId`). The orchestrator reacts to this as a third outcome alongside
complete/fail: it writes an inbox task via `InboxTaskPort` and marks the job `waiting`. A `resume`
job later reloads the same checkpoint and continues — see
[ADR-0004](ADR/0004-langgraph-interrupt-resume-for-form-hitl-nodes.md).
```

- [ ] **Step 3: Add backlog and known-issues entries**

Append to `docs/backlog.md`:

```markdown
## Real `InboxTaskPort` implementation

**Description:** The orchestrator depends on `InboxTaskPort` to durably record a paused run's
pending human input; only `FakeInboxTaskWriter` (in-memory, test-only) exists. A real
implementation needs to write into `home`'s tenant-scoped `inbox_tasks` table, which requires
resolving the engine's tenant-DB credential/grant model (see
`agent-builder/docs/superpowers/specs/2026-08-27-execution-engine-architecture-design.md` Section 4,
still open).

**Value:** Without it, a form/HITL node can pause a run but the pause is never durably surfaced to
a human anywhere — the run is stuck `waiting` forever.

**Consequence of not having it:** The Form node feature is not usable end-to-end in any real
environment.

## Move `PostgresSaver.setup()` out of the per-execution worker

**Description:** `graph-execution.worker.ts` calls `checkpointer.setup()` on every worker spawn.
It's idempotent (safe to call repeatedly) but redundant once the engine runs at real throughput —
it should run once at process bootstrap instead.

**Value:** Removes a redundant round-trip per execution.

**Consequence of not having it:** Slightly higher per-execution latency; no correctness impact.
```

Append to `docs/known-issues/index.md`:

```markdown
## `InboxTaskPort` has no real implementation

**Where**: `src/graph/inbox-task.port.ts`, `src/graph/fake-inbox-task-writer.ts`.

**Issue**: the orchestrator calls `InboxTaskPort.createTask()` when a form node interrupts, but the
only implementation wired anywhere is `FakeInboxTaskWriter` (in-memory, used only in tests). No
production code path writes an actual durable inbox task.

**Current impact**: a run that hits a form node pauses (`jobs.status = 'waiting'`) but nothing
outside the test suite is ever notified — there is no way, today, for a real human to answer it.

**Fix, if/when it matters**: see the "Real `InboxTaskPort` implementation" entry in
[`../backlog.md`](../backlog.md).
```

- [ ] **Step 4: Add a changes.md entry**

Append to `docs/changes.md` (create the file with a `# Changes` header first if it doesn't already
exist):

```markdown
## 2026-09-04 — Form node engine support

Generalized `GraphInterpreter` from a single hardcoded `llm` node to walking an arbitrary
multi-node graph, and added a `form` node type that pauses execution via LangGraph `interrupt()`,
checkpoints via `PostgresSaver`, and resumes via a new `resume` job type. See
[ADR-0004](architecture/ADR/0004-langgraph-interrupt-resume-for-form-hitl-nodes.md) and
`home/docs/superpowers/specs/2026-09-04-flow-builder-form-node-design.md`.
```

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs: record form-node engine support architecture and follow-ups"
```

---

## Self-Review Notes

- **Spec coverage:** the design spec's Section D items 1–6 map directly to Tasks 1–3 (types +
  dynamic state + multi-node walk + form/interrupt), 6 (worker message contract), 7 (worker/
  PostgresSaver wiring), 5 (orchestrator waiting/job status), and 8 (orchestrator resume handling +
  assignee resolution). The spec's Dependencies section (tenant-DB credential model) is explicitly
  deferred via the `InboxTaskPort`/`FakeInboxTaskWriter` split, matching the existing
  `LlmProviderPort`/`FakeLlmProvider` precedent already in this codebase.
- **Type consistency:** `WorkerData`/`WorkerMessage` (Task 6) are the single shared types used by
  `graph-execution.worker.ts` (Task 7), `worker-runner.service.ts` (Task 7), and
  `execution-orchestrator.service.ts` (Task 8) — no renamed duplicates. `FormField`/`FormNodeData`
  (Task 1) are the one shape referenced by `GraphInterpreter` (Task 3), `WorkerMessage`'s
  `waiting_for_input` variant (Task 6), and `InboxTask` (Task 4).
- **Known follow-up, not a gap in this plan:** per-execution `checkpointer.setup()` and the
  in-memory-only `InboxTaskPort` are both flagged in Task 9's backlog additions, not silently left
  undocumented.
