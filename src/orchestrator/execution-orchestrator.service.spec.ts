import { ExecutionOrchestratorService } from './execution-orchestrator.service';
import type { TenantRegistryService } from '../tenants/tenant-registry.service';
import type { JobClaimService } from '../jobs/job-claim.service';
import type { WorkerRunnerService } from '../worker/worker-runner.service';
import type { ProgressPublisherService } from '../progress/progress-publisher.service';
import type { TenantInboxTaskWriter } from '../graph/tenant-inbox-task-writer';
import type { ClaimedJob } from '../jobs/job.types';
import type {
  WorkerData,
  WorkerMessage,
} from '../worker/worker-messages.types';
import type { GraphDefinition } from '../graph/graph-definition.types';

// Unit tests: every collaborator is an in-memory fake, so these run without
// Postgres or a worker thread. The SQL and LISTEN/NOTIFY behavior is covered
// by the *.integration.spec.ts files.

const definition: GraphDefinition = {
  entryNodeId: 'llm-1',
  nodes: [],
  edges: [],
  stateSchema: { fields: [] },
};

class FakeTenantRegistry {
  constructor(public schemas: string[] = []) {}
  listTenantSchemas(): Promise<string[]> {
    return Promise.resolve([...this.schemas]);
  }
}

class FakeJobClaimService {
  pending = new Map<string, ClaimedJob[]>();
  completed: string[] = [];
  failed: Array<{ jobId: string; error: string }> = [];
  waiting: Array<{ jobId: string; runId: string }> = [];

  enqueue(schemaName: string, job: Partial<ClaimedJob> & { id: string }) {
    const queue = this.pending.get(schemaName) ?? [];
    queue.push({
      type: 'run',
      schemaName,
      graphId: 'graph-1',
      userId: 'user-1',
      runId: null,
      input: { definition, input: { input: 'hi' } },
      ...job,
    });
    this.pending.set(schemaName, queue);
  }

  claimNext(schemaName: string): Promise<ClaimedJob | null> {
    return Promise.resolve(this.pending.get(schemaName)?.shift() ?? null);
  }

  complete(_schemaName: string, jobId: string) {
    this.completed.push(jobId);
  }

  fail(_schemaName: string, jobId: string, error: string) {
    this.failed.push({ jobId, error });
  }

  markWaiting(_schemaName: string, jobId: string, runId: string) {
    this.waiting.push({ jobId, runId });
  }
}

class FakeWorkerRunner {
  calls: WorkerData[] = [];
  // Messages yielded for the next run; an Error instance makes run() throw.
  script: WorkerMessage[] | Error = [{ kind: 'done' }];

  *run(data: WorkerData): Generator<WorkerMessage> {
    this.calls.push(data);
    if (this.script instanceof Error) throw this.script;
    for (const message of this.script) yield message;
  }
}

class FakeProgressPublisher {
  published: Array<{ runId: string; message: WorkerMessage }> = [];
  publish(runId: string, message: WorkerMessage) {
    this.published.push({ runId, message });
  }
}

class FakeInboxTaskWriter {
  tasks: Array<Record<string, unknown>> = [];
  createTask(task: Record<string, unknown>) {
    this.tasks.push(task);
  }
}

describe('ExecutionOrchestratorService', () => {
  let registry: FakeTenantRegistry;
  let claims: FakeJobClaimService;
  let runner: FakeWorkerRunner;
  let publisher: FakeProgressPublisher;
  let inbox: FakeInboxTaskWriter;
  let orchestrator: ExecutionOrchestratorService;

  beforeEach(() => {
    registry = new FakeTenantRegistry(['tenant_a']);
    claims = new FakeJobClaimService();
    runner = new FakeWorkerRunner();
    publisher = new FakeProgressPublisher();
    inbox = new FakeInboxTaskWriter();
    orchestrator = new ExecutionOrchestratorService(
      registry as unknown as TenantRegistryService,
      claims as unknown as JobClaimService,
      runner as unknown as WorkerRunnerService,
      publisher as unknown as ProgressPublisherService,
      inbox as unknown as TenantInboxTaskWriter,
    );
  });

  it('returns false when there is no registered tenant', async () => {
    registry.schemas = [];
    expect(await orchestrator.processNext()).toBe(false);
  });

  it('returns false when no registered tenant has a pending job', async () => {
    expect(await orchestrator.processNext()).toBe(false);
    expect(claims.completed).toEqual([]);
  });

  it('runs a start job, publishes its messages and marks it completed', async () => {
    claims.enqueue('tenant_a', { id: 'job-1' });
    runner.script = [
      { kind: 'token', nodeId: 'llm-1', token: 'Hi' },
      { kind: 'done' },
    ];

    expect(await orchestrator.processNext()).toBe(true);

    expect(runner.calls).toEqual([
      {
        kind: 'start',
        runId: 'job-1',
        schemaName: 'tenant_a',
        definition,
        input: { input: 'hi' },
      },
    ]);
    expect(publisher.published.map((p) => p.message.kind)).toEqual([
      'token',
      'done',
    ]);
    expect(publisher.published.every((p) => p.runId === 'job-1')).toBe(true);
    expect(claims.completed).toEqual(['job-1']);
    expect(claims.failed).toEqual([]);
  });

  it('builds a resume worker input from a resume job', async () => {
    claims.enqueue('tenant_a', {
      id: 'job-2',
      type: 'resume',
      runId: 'run-9',
      input: { definition, resumeValues: { approved: true } },
    });

    await orchestrator.processNext();

    expect(runner.calls).toEqual([
      {
        kind: 'resume',
        runId: 'run-9',
        schemaName: 'tenant_a',
        definition,
        resumeValues: { approved: true },
      },
    ]);
    expect(claims.completed).toEqual(['job-2']);
  });

  it('fails the job once when the worker emits an error message', async () => {
    claims.enqueue('tenant_a', { id: 'job-3' });
    runner.script = [{ kind: 'error', message: "Unknown entryNodeId 'llm-1'" }];

    expect(await orchestrator.processNext()).toBe(true);

    expect(claims.failed).toEqual([
      { jobId: 'job-3', error: "Unknown entryNodeId 'llm-1'" },
    ]);
    expect(claims.completed).toEqual([]);
  });

  it('creates an inbox task for the launcher and marks the job waiting on a form interrupt', async () => {
    claims.enqueue('tenant_a', { id: 'job-4', userId: 'launcher-1' });
    runner.script = [
      {
        kind: 'waiting_for_input',
        nodeId: 'form-1',
        prompt: 'Approve?',
        fields: [
          {
            key: 'approved',
            label: 'Approved?',
            type: 'boolean',
            required: true,
          },
        ],
        assigneeMode: 'launcher',
      },
    ];

    await orchestrator.processNext();

    expect(inbox.tasks).toEqual([
      {
        schemaName: 'tenant_a',
        runId: 'job-4',
        nodeId: 'form-1',
        prompt: 'Approve?',
        fields: [
          {
            key: 'approved',
            label: 'Approved?',
            type: 'boolean',
            required: true,
          },
        ],
        assigneeUserId: 'launcher-1',
      },
    ]);
    expect(claims.waiting).toEqual([{ jobId: 'job-4', runId: 'job-4' }]);
    expect(claims.completed).toEqual([]);
  });

  it('assigns the inbox task to the specific user when the form asks for one', async () => {
    claims.enqueue('tenant_a', { id: 'job-5' });
    runner.script = [
      {
        kind: 'waiting_for_input',
        nodeId: 'form-1',
        prompt: 'Approve?',
        fields: [],
        assigneeMode: 'specific_user',
        assigneeUserId: 'approver-7',
      },
    ];

    await orchestrator.processNext();

    expect(inbox.tasks[0]).toMatchObject({ assigneeUserId: 'approver-7' });
  });

  it('fails the job with the thrown message when the worker run throws', async () => {
    claims.enqueue('tenant_a', { id: 'job-6' });
    runner.script = new Error('worker crashed');

    expect(await orchestrator.processNext()).toBe(true);

    expect(publisher.published).toEqual([
      { runId: 'job-6', message: { kind: 'error', message: 'worker crashed' } },
    ]);
    expect(claims.failed).toEqual([
      { jobId: 'job-6', error: 'worker crashed' },
    ]);
  });

  it('round-robins across tenants instead of draining one first', async () => {
    registry.schemas = ['tenant_a', 'tenant_b'];
    claims.enqueue('tenant_a', { id: 'a-1' });
    claims.enqueue('tenant_a', { id: 'a-2' });
    claims.enqueue('tenant_b', { id: 'b-1' });

    await orchestrator.processNext();
    await orchestrator.processNext();

    expect(claims.completed).toEqual(['a-1', 'b-1']);
  });
});
