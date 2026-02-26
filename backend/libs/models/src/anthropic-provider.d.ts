import { AIModel, ChatMessage } from '@libs/contracts';
import { BaseAIProvider } from './base-provider';
export declare class AnthropicProvider extends BaseAIProvider {
    constructor(model: AIModel, apiKey?: string);
    chat(messages: ChatMessage[], options?: any): Promise<string>;
    streamingChat(messages: ChatMessage[], onToken: (token: string) => void, options?: any): Promise<void>;
    private buildMessagePayload;
    private requestAnthropic;
    private separateMessages;
}
