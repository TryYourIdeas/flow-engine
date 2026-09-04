import type { FormField } from './graph-definition.types';

export interface InboxTask {
  schemaName: string;
  runId: string;
  nodeId: string;
  prompt: string;
  fields: FormField[];
  assigneeUserId: string;
}

export interface InboxTaskPort {
  createTask(task: InboxTask): Promise<void>;
}
