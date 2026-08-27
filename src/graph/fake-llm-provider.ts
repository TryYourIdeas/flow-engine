import type { LlmProviderPort, LlmCompletionParams } from './llm-provider.port';

export class FakeLlmProvider implements LlmProviderPort {
  constructor(private readonly tokens: string[] = ['Hello', ', ', 'world', '!']) {}

  async *streamCompletion(
    _params: LlmCompletionParams,
  ): AsyncIterable<{ token: string }> {
    for (const token of this.tokens) {
      yield { token };
    }
  }
}
