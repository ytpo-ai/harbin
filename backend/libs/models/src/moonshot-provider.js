"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MoonshotProvider = void 0;
const openai_1 = require("openai");
const undici_1 = require("undici");
const infra_1 = require("@libs/infra");
const base_provider_1 = require("./base-provider");
const DEFAULT_MOONSHOT_BASE_URL = 'https://api.moonshot.cn/v1';
class MoonshotProvider extends base_provider_1.BaseAIProvider {
    constructor(model, apiKey) {
        const resolvedApiKey = (apiKey || process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || '').trim();
        super(model, resolvedApiKey);
        const dispatcher = (0, infra_1.getProxyDispatcher)();
        const clientOptions = {
            apiKey: resolvedApiKey,
            baseURL: process.env.MOONSHOT_BASE_URL || DEFAULT_MOONSHOT_BASE_URL,
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
        this.ensureApiKey();
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
        this.ensureApiKey();
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
    ensureApiKey() {
        if (!this.apiKey || !this.apiKey.trim()) {
            throw new Error('Missing MOONSHOT_API_KEY (or KIMI_API_KEY)');
        }
    }
}
exports.MoonshotProvider = MoonshotProvider;
//# sourceMappingURL=moonshot-provider.js.map