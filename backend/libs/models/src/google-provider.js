"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleAIProvider = void 0;
const generative_ai_1 = require("@google/generative-ai");
const base_provider_1 = require("./base-provider");
class GoogleAIProvider extends base_provider_1.BaseAIProvider {
    constructor(model, apiKey) {
        super(model, apiKey);
        this.client = new generative_ai_1.GoogleGenerativeAI(apiKey || process.env.GOOGLE_AI_API_KEY);
    }
    async chat(messages, options) {
        const genAI = this.client.getGenerativeModel({
            model: this.model.model,
            generationConfig: {
                maxOutputTokens: options?.maxTokens || this.model.maxTokens,
                temperature: options?.temperature || this.model.temperature || 0.7,
                topP: options?.topP || this.model.topP || 1,
            },
        });
        const prompt = this.formatGeminiMessages(messages);
        const result = await genAI.generateContent(prompt);
        return result.response.text() || '';
    }
    async streamingChat(messages, onToken, options) {
        const genAI = this.client.getGenerativeModel({
            model: this.model.model,
            generationConfig: {
                maxOutputTokens: options?.maxTokens || this.model.maxTokens,
                temperature: options?.temperature || this.model.temperature || 0.7,
                topP: options?.topP || this.model.topP || 1,
            },
        });
        const prompt = this.formatGeminiMessages(messages);
        const result = await genAI.generateContentStream(prompt);
        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            if (chunkText) {
                onToken(chunkText);
            }
        }
    }
    formatGeminiMessages(messages) {
        let prompt = '';
        for (const message of messages) {
            if (message.role === 'system') {
                prompt += `System: ${message.content}\n\n`;
            }
            else if (message.role === 'user') {
                prompt += `Human: ${message.content}\n\n`;
            }
            else if (message.role === 'assistant') {
                prompt += `Assistant: ${message.content}\n\n`;
            }
        }
        prompt += 'Assistant: ';
        return prompt;
    }
}
exports.GoogleAIProvider = GoogleAIProvider;
//# sourceMappingURL=google-provider.js.map