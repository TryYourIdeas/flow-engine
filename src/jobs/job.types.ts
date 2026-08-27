export interface ClaimedJob {
  id: string;
  type: 'run' | 'resume';
  tenantId: string;
  userId: string;
  graphId: string;
  runId: string | null;
  input: unknown;
}
