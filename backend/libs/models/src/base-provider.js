"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseAIProvider = void 0;
class BaseAIProvider {
    constructor(model, apiKey) {
        this.model = model;
        this.apiKey = apiKey;
    }
    formatMessages(messages) {
        return messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
        }));
    }
    get modelInfo() {
        return this.model;
    }
}
exports.BaseAIProvider = BaseAIProvider;
//# sourceMappingURL=base-provider.js.map