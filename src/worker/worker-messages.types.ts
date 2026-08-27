import type { GraphDefinition } from '../graph/graph-definition.types';

export interface WorkerData {
  definition: GraphDefinition;
  input: { input: string };
}

export type WorkerMessage =
  | { kind: 'token'; nodeId: string; token: string }
  | { kind: 'done' }
  | { kind: 'error'; message: string };
