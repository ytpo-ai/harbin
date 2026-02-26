import { AIModel, ChatMessage } from '@libs/contracts';
export declare abstract class BaseAIProvider {
    protected model: AIModel;
    protected apiKey?: string;
    constructor(model: AIModel, apiKey?: string);
    abstract chat(messages: ChatMessage[], options?: any): Promise<string>;
    abstract streamingChat(messages: ChatMessage[], onToken: (token: string) => void, options?: any): Promise<void>;
    protected formatMessages(messages: ChatMessage[]): any[];
    get modelInfo(): AIModel;
}
