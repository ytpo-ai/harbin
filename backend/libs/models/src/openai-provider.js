"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIProvider = void 0;
const openai_1 = require("openai");
const undici_1 = require("undici");
const infra_1 = require("@libs/infra");
const base_provider_1 = require("./base-provider");
class OpenAIProvider extends base_provider_1.BaseAIProvider {
    constructor(model, apiKey) {
        super(model, apiKey);
        const dispatcher = (0, infra_1.getProxyDispatcher)();
        const clientOptions = {
            apiKey: apiKey || process.env.OPENAI_API_KEY,
            timeout: 15000,
            maxRetries: 0,
        };
        if (dispatcher) {
            clientOptions.fetch = (url, init) => (0, undici_1.fetch)(url, {
                ...init,
                dispatcher,
            });
        }
        this.client = new openai_1.default(clientOptions);
    }
    async chat(messages, options) {
        const response = await this.client.chat.completions.create({
            model: this.model.model,
            messages: this.formatMessages(messages),
            max_tokens: options?.maxTokens || this.model.maxTokens,
            temperature: options?.temperature || this.model.temperature || 0.7,
            top_p: options?.topP || this.model.topP || 1,
        });
        return response.choices[0]?.message?.content || '';
    }
    async streamingChat(messages, onToken, options) {
        const stream = await this.client.chat.completions.create({
            model: this.model.model,
            messages: this.formatMessages(messages),
            max_tokens: options?.maxTokens || this.model.maxTokens,
            temperature: options?.temperature || this.model.temperature || 0.7,
            top_p: options?.topP || this.model.topP || 1,
            stream: true,
        });
        for await (const chunk of stream) {
            const token = chunk.choices[0]?.delta?.content || '';
            if (token) {
                onToken(token);
            }
        }
    }
}
exports.OpenAIProvider = OpenAIProvider;
//# sourceMappingURL=openai-provider.js.map