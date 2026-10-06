export interface LlmCompletionParams {
    systemPrompt: string;
    model: string;
    temperature: number;
    input: string;
}
export interface LlmProviderPort {
    streamCompletion(params: LlmCompletionParams): AsyncIterable<{
        token: string;
    }>;
}
