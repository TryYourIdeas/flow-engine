import { type BaseCheckpointSaver } from '@langchain/langgraph';
import type { GraphDefinition, FormField } from './graph-definition.types';
import type { LlmProviderPort } from './llm-provider.port';
export interface FormInterruptPayload {
    nodeId: string;
    prompt: string;
    fields: FormField[];
    assigneeMode: 'launcher' | 'specific_user';
    assigneeUserId?: string;
}
export type InterpreterEvent = {
    kind: 'token';
    nodeId: string;
    token: string;
} | ({
    kind: 'interrupted';
} & FormInterruptPayload);
export interface InterpreterStartInput {
    kind: 'start';
    input: string;
}
export interface InterpreterResumeInput {
    kind: 'resume';
    resumeValues: Record<string, unknown>;
}
export type InterpreterInput = InterpreterStartInput | InterpreterResumeInput;
export declare class GraphInterpreter {
    private readonly llmProvider;
    private readonly checkpointer;
    constructor(llmProvider: LlmProviderPort, checkpointer: BaseCheckpointSaver);
    run(definition: GraphDefinition, runId: string, input: InterpreterInput): AsyncGenerator<InterpreterEvent>;
}
