import { AIModel, ChatMessage } from '@libs/contracts';
import { BaseAIProvider } from './base-provider';
export declare class MoonshotProvider extends BaseAIProvider {
    private client;
    constructor(model: AIModel, apiKey?: string);
    chat(messages: ChatMessage[], options?: any): Promise<string>;
    streamingChat(messages: ChatMessage[], onToken: (token: string) => void, options?: any): Promise<void>;
    private ensureApiKey;
}
