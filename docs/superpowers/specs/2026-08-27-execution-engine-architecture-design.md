# Execution Engine Architecture — Design

**Date:** 2026-08-27 (revised same day — see revision note)
**Status:** Draft — architectural decision superseding the original in-process design below
**Related:** `.planning/ROADMAP.md`, `.planning/phases/04-execution-engine-streaming/04-CONTEXT.md`,
`.planning/STATE.md`, `home/docs/superpowers/specs/2026-08-27-agent-builder-merge-into-home-design.md`

---

## Revision note

The first version of this design (still preserved in [Section 5](#5-superseded-in-process-design))
assumed `agent-builder` stays a standalone app deployed on its own VPS, running executions
in-process via `worker_threads` inside its own Nitro server. Two things changed that assumption:

1. `agent-builder` is being merged into `home` and retired as a standalone app (canvas/authoring
   moves to `home` under `/flow-builder`); the merge design explicitly puts the execution engine
   out of scope, to be designed separately against `home`'s codebase.
2. The user decided the execution engine should **not** live inside `home`'s shared Nitro process
   at all — it runs as its own separate **NestJS service**, decoupled from `flow-builder` via a
   queue, so that a runaway or heavy execution can never degrade `home`'s other tenant-facing
   traffic (chat, prompts, `ai-os`), and so the engine can be scaled independently of `home`.

This revision reflects that decision. Section 5 is kept for its still-relevant sub-decisions
(interpretation strategy, `worker_threads`-per-execution isolation) which carry forward unchanged
into the new service, and for the record of why the original process model was chosen.

---

## 1. Problem

Run a user-authored graph (`GraphDefinition` JSON, authored in flow-builder's canvas) and deliver
its output — including mid-run requests for human input — back to the browser, in a system where:

- flow-builder (authoring, scheduling, launching runs) lives inside `home`, a single shared
  Nitro process serving many tenants and several unrelated products.
- Runs must not be able to degrade `home`'s other traffic, and many tenants may run graphs
  concurrently.
- Some graphs pause mid-run to ask the user a question (Human-in-the-Loop node) and must resume
  from exactly that point once answered, even if the process that started the run no longer exists
  by the time the answer arrives.

---

## 2. Decision

### 2.1 Component split

- **flow-builder** (inside `home`) — owns authoring, scheduling, and launching. Never executes a
  graph itself.
- **execution-engine** — a separate NestJS service, deployed and scaled independently of `home`.
  The only thing that runs LangGraph JS.

### 2.2 Data access

The execution-engine reads tenant data **directly from Postgres**, using its own credentials
scoped to the tenant schemas it needs (least-privilege role, distinct from `home`'s application
credentials). A queued job carries only `graph_id`, `tenant_id`, and `user_id` — the engine
resolves the `GraphDefinition` and decrypts the tenant's LLM provider keys itself. `home` never
assembles or transmits that payload.

### 2.3 Transport: Postgres-backed queue (no new infra)

No Redis/RabbitMQ. A jobs table in Postgres serves as the queue in both directions:

- **Run jobs** (`flow-builder → engine`): flow-builder inserts a row (`type: 'run'`, `graph_id`,
  `tenant_id`, `user_id`, `status: 'pending'`). Engine instances claim rows with
  `SELECT ... FOR UPDATE SKIP LOCKED`, so multiple engine instances can safely compete for work —
  this is what lets N tenants run graphs in parallel by adding engine capacity, not by any
  in-process queue inside `home`.
- **Progress/output** (`engine → flow-builder`): the engine publishes token/node-event/error
  messages via Postgres `NOTIFY` on a `run:<run_id>` channel (buffered a few tokens at a time, per
  the execution panel's existing streaming spec). `home` holds a listener subscribed to active run
  channels and relays events to the browser over its existing SSE endpoint — the browser only ever
  talks to `home`, one origin, existing auth, unchanged from today's UX.
- **Resume jobs** (`flow-builder → engine`, for HITL — see [Section 3](#3-human-in-the-loop-mid-run-input)):
  same jobs table, `type: 'resume'`, carrying `run_id` and the user's input value.

`NOTIFY` payload size and delivery-on-restart limits are accepted for now given the
already-planned token buffering; polling is the fallback if a listener reconnects mid-run (see
Open Questions).

### 2.4 Per-execution isolation

Each claimed job still runs inside its own `worker_thread` within the engine instance that claimed
it — unchanged from the original design (Section 5). This means isolation is layered: process-level
(the engine is a separate service from `home`) **and** thread-level (one misbehaving execution
can't take down other concurrent executions on the same engine instance). An engine instance can
therefore safely claim and run multiple jobs concurrently without one hanging job blocking others.

### 2.5 Checkpointing

Checkpoint state is externalized to Postgres via LangGraph's `PostgresSaver`, not held in a
worker's memory. This is what makes the async, decoupled queue model work for HITL: a paused
worker can be torn down completely, and "resume" is simply "a new worker, on any engine instance,
loads the checkpoint and continues" — no requirement that the original process/thread still be
alive when the user answers.

---

## 3. Human-in-the-loop: durable inbox, not live-panel input

Mid-run input requests are modeled as a **durable inbox task**, not a live SSE round-trip. This
was chosen over an initially-proposed live-panel-input approach because a human response can take
arbitrarily long (minutes to days), and tying that to a live SSE connection/pub-sub event meant the
signal could be missed on reconnect and the user had no durable record of "something needs my
attention." An inbox row is both the notification and the source of truth.

### 3.1 `inbox_tasks` table (new, `home`-side, tenant-scoped)

| Column | Notes |
|---|---|
| `id` | PK |
| `tenant_id` | tenant scoping, consistent with `home`'s other tenant tables |
| `run_id` | which run this task belongs to |
| `node_id` | which HITL node in the graph raised it |
| `assignee_user_id` | resolved at creation time — see 3.2 |
| `prompt` | context/question shown to the user |
| `status` | `pending` \| `completed` |
| `input` | the user's response; null until completed |
| `created_at`, `completed_at` | |

### 3.2 Assignee resolution (design-time, per HITL node)

Each HITL node is configured at graph-authoring time with one of two assignee modes — no
role/org-chart lookup, since no such system exists yet (`myteam`/`cani` are both unscaffolded
idea-stage projects):

- **`launcher`** — resolves per-run to whoever triggered the run (the job's `user_id`). This is
  how "kick it back to the same user if their form submission was incomplete" works: the node's
  rule is fixed at design time, but it resolves to a different actual user per run.
- **`specific_user`** — a fixed user picked from a dropdown when building the graph (e.g. a named
  manager for an escalation step).

### 3.3 Flow

1. The engine's worker hits LangGraph's `interrupt()`, which checkpoints state via `PostgresSaver`
   and halts.
2. The engine resolves the assignee per 3.2 and inserts a row into `inbox_tasks`
   (`status: 'pending'`). The worker is then torn down — no need to hold a thread open while
   waiting on a human, potentially for a long time.
3. In-app notification only for now (badge/count on `/inbox`); email via `home`'s existing
   Mailgun util (`server/lib/mails/mailgun.ts`) is deferred to a follow-up.
4. The execution panel, while a run is paused on a HITL node, shows a passive
   "Waiting for input — see your inbox" state — **no live inline input field**. Answering always
   happens through `/inbox`, never through the panel.
5. The assignee opens `/inbox`, sees their pending tasks (tenant- and user-scoped), opens the task,
   and submits a response. This marks the `inbox_tasks` row `completed` (recording `input` and
   `completed_at`) and inserts a **resume job** (`type: 'resume'`, `run_id`, `input`) into the same
   Postgres jobs table used for starting runs — reusing that mechanism rather than adding a second
   transport, since resume is symmetric to "start a run."
6. Any engine instance claims the resume job via the same `SELECT ... FOR UPDATE SKIP LOCKED`
   pattern, spins up a fresh worker, loads the checkpoint, calls `Command({ resume: input })`, and
   execution continues — publishing further `run:<run_id>` progress events the same way as before
   the pause.

This also removes the earlier `NOTIFY`-reconnect fragility concern for HITL specifically: the
"needs input" signal is now a durable row, not a pub/sub event that can be missed. The jobs-table
`NOTIFY` channel is still used for live token/progress streaming during active execution, but is no
longer the source of truth for whether a run is waiting on a human — `inbox_tasks.status` is.

---

## 4. Open Questions

- **Per-tenant fairness/concurrency caps.** The `SELECT ... FOR UPDATE SKIP LOCKED` claim pattern
  gives global parallelism across engine instances, but nothing yet stops one tenant from
  monopolizing the queue if they submit many runs at once. Needs a claim-time rule (e.g. cap
  in-flight jobs per tenant) before this ships.
- **Engine DB credentials/security boundary.** The engine's Postgres role needs to be scoped
  (read/decrypt only what's needed per tenant schema) and kept distinct from `home`'s application
  role — exact grant model not yet specified.
- **`NOTIFY` reliability on listener reconnect for live token streaming.** Still relevant for
  in-progress (non-paused) runs: Postgres `NOTIFY` does not redeliver missed messages to a listener
  that reconnects mid-run. No longer a correctness concern for HITL (see Section 3), but a
  reconciliation read on SSE (re)connect (query current run status/last-seen output) is still
  needed so a client that drops mid-stream doesn't just see a stalled panel.
- **Deployment topology for the engine** (same VPS as `home` in a separate container vs. a
  dedicated VPS) is not yet decided.
- **Scheduling semantics** ("schedule flows," mentioned as a flow-builder responsibility) is net
  new scope beyond the original Phase 4 roadmap and has not been designed — it presumably becomes
  another producer of `type: 'run'` jobs into the same queue, but timing/recurrence/ownership needs
  its own discussion.
- **Inbox task visibility/expiry.** Whether completed tasks stay visible in `/inbox` (history) or
  are archived/hidden after some period, and whether a `pending` task should ever expire or escalate
  (e.g. reassign) if left unanswered too long, is not yet decided.
- Message-passing contract between the `worker_thread` and its host engine process (token chunks,
  node-enter/exit events, error envelopes) is still unspecified at the implementation-detail level.
- Whether a per-worker resource cap (`resourceLimits`) should be enforced is still open, and
  matters most once Phase 5's untrusted custom-JS tool node lands.

---

## 5. Superseded: in-process design

*(Kept for reference. The interpretation strategy and `worker_threads`-per-execution isolation
decisions below carry forward unchanged into the new architecture above; the process/deployment
model — running inside agent-builder's own Nitro process on a dedicated VPS — does not.)*

### 5.1 Original decision

A node-type registry (`llm` now; `tool`, `router`, `hitl` in Phase 5) would walk the
`GraphDefinition` JSON at execution time and build a LangGraph JS `StateGraph` dynamically. Each
execution would run inside its own `worker_threads` worker within agent-builder's own Nitro
process, posting progress back to the main thread for SSE relay directly to the client.

### 5.2 Architectural alternatives considered (interpretation + process model)

| Option | Description | Why not chosen |
|---|---|---|
| **B — Codegen-first** | Build the Phase 7 TS code generator now; execution dynamically imports/evaluates the generated module instead of interpreting JSON directly. | Pulls Phase 7 scope into Phase 4; adds a compile/eval step; sandboxing has to reason about generated+dynamic code rather than a fixed interpreter. |
| **C — Separate execution worker service + queue** | Nitro only validates and enqueues; a standalone worker process owns all graph runs; SSE endpoint relays via pub/sub. | At the time, judged disproportionate infra for a single-VPS deployment with capped concurrency. **This is effectively the direction ultimately chosen once the deployment context changed (Section 2).** |

### 5.3 Framework alternatives to LangChain/LangGraph JS

Researched TS/JS-native (or TS-friendly) agent/workflow orchestration frameworks against this
project's requirements: build an arbitrary graph from JSON at runtime, SSE-compatible streaming,
durable checkpointing for HITL, tool calling incl. sandboxed custom JS, self-hostable, TS-native,
actively maintained. This survey is unaffected by the process-model revision above — it concerns
which library builds and runs the graph, not which service hosts it.

| Framework | Verdict | Rationale |
|---|---|---|
| **LangGraph JS** (chosen) | Strong fit | Purpose-built for exactly this model: node/edge graph, `PostgresSaver`, `interrupt`/`Command(resume)`, TS-native, large ecosystem. Trade-off: lower-level/more verbose API — you own the interpreter and worker infra either way, with any framework. |
| **Mastra** | Credible alternative, not chosen | Batteries-included TS-native agent framework with its own visual Studio UI. Workflow model is closer to an opinionated app framework than a raw graph primitive — would need bending to fit an arbitrary user-authored `GraphDefinition`. Younger project, less proven at "arbitrary user-authored graph" scale. |
| **Restate** | Credible for the checkpointing layer specifically, not adopted now | Single-binary durable execution engine, purpose-built for "long HITL wait without losing state," leaner self-host than Temporal. Has no graph-from-JSON abstraction of its own — would replace `PostgresSaver` as the durability substrate, not the graph runtime. Worth revisiting only if Postgres-backed checkpointing proves insufficient in practice. |
| **Vercel AI SDK / Workflows** | Best streaming ergonomics, weak fit otherwise | Excellent SSE/streaming primitives, but the Workflows product's self-host durability story is thin (managed-storage-first). More useful as the streaming layer *inside* whichever graph engine is chosen than as a full replacement. |
| **Temporal (TS SDK)** | Viable, too heavy | Best-in-class durability/HITL guarantees, but a full Temporal server plus its own database is real operational overhead. Still wouldn't provide graph-from-JSON interpretation or tool sandboxing — only solves durability. |
| **OpenAI Agents SDK (TS)** | Second-tier | Clean, self-hostable primitives with good interrupt/approval streaming, but its "Handoffs" model is shaped for multi-agent delegation, not a general DAG with a Conditional Router node. |
| **Inngest AgentKit** | Second-tier | Real `waitForEvent()` HITL primitive with durable checkpointing built in, but self-hosting Inngest's own durable-execution engine is heavier and less common than LangGraph + Postgres. |
| **Google Genkit** | Second-tier | Self-hostable and provider-neutral, but positioned as weaker than LangGraph specifically on state/branching/approvals — this project's exact requirements. |
| **LlamaIndex.TS** | Disqualified | TS port archived/unmaintained as of 2026; LlamaIndex's workflow investment moved to Python. |
| **CrewAI / AutoGen (AG2)** | Disqualified | Python-only; no TS runtime. |
| **xstate** | Not an agent framework | General state-machine library — could hand-roll a graph interpreter and checkpointing on top of it, but that means rebuilding the LLM/tool/streaming primitives LangGraph already provides. |

**Conclusion (unchanged):** no researched alternative beats LangGraph JS on the requirement that
matters most here — arbitrary graphs authored via a visual canvas, with a Conditional Router node
and durable HITL interrupts. Restate remains worth keeping in mind as a narrower swap for the
checkpointing layer alone if Postgres-backed checkpointing proves insufficient once Phase 6/HITL
is implemented in the new engine.

---

## 6. Roadmap Impact

- This design now targets a **NestJS execution-engine service**, separate from both the original
  `agent-builder` app and `home`/flow-builder — not covered by either the original Phase 4 roadmap
  (`agent-builder`-hosted) or the merge design (`home`-hosted, execution explicitly out of scope).
  It needs its own phase/plan sequencing, likely as work that begins after (or in parallel with)
  the `agent-builder`→`home` merge lands.
- `worker_threads`-per-execution still pre-resolves the `STATE.md` open decision "custom JS
  sandboxing: `isolated-vm` vs. `worker_threads`" in favor of `worker_threads`, now inside the
  engine service rather than inside `agent-builder`/`home`.
- Phase 7 (TS code export) remains a separate consumer of `GraphDefinition`, unaffected by where
  execution runs.
