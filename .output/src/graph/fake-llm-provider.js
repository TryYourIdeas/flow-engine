"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FakeLlmProvider = void 0;
class FakeLlmProvider {
    tokens;
    constructor(tokens = ['Hello', ', ', 'world', '!']) {
        this.tokens = tokens;
    }
    async *streamCompletion(_params) {
        for (const token of this.tokens) {
            yield { token };
        }
    }
}
exports.FakeLlmProvider = FakeLlmProvider;
//# sourceMappingURL=fake-llm-provider.js.map