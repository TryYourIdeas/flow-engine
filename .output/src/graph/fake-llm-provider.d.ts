import type { LlmProviderPort, LlmCompletionParams } from './llm-provider.port';
export declare class FakeLlmProvider implements LlmProviderPort {
    private readonly tokens;
    constructor(tokens?: string[]);
    streamCompletion(_params: LlmCompletionParams): AsyncIterable<{
        token: string;
    }>;
}
