export interface ClaimedJob {
    id: string;
    type: 'run' | 'resume';
    schemaName: string;
    graphId: string;
    userId: string;
    runId: string | null;
    input: unknown;
}
