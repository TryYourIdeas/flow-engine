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
  | ({ kind: 'start'; runId: string; schemaName: string } & RunJobInput)
  | ({ kind: 'resume'; runId: string; schemaName: string } & ResumeJobInput);

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
